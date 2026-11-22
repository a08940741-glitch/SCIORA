import { z } from "zod";

/**
 * Converts a SCIORA zod output schema into a JSON Schema accepted by Groq's strict
 * structured outputs (`response_format: { type: "json_schema", json_schema: { strict: true } }`).
 *
 * Groq documents for strict mode: every property required, `additionalProperties: false`,
 * types string/number/integer/boolean/object/array/enum, and `anyOf` for unions.
 * Support for other keywords (pattern, min/max length, min/max items, numeric ranges) is
 * NOT documented, so they are moved out of the schema sent to Groq and written into the
 * field's description as a hint instead. Exact single-character patterns are the exception:
 * they become an enum (see patternToEnum), which strict mode does support.
 *
 * Validation is NOT weakened: the full zod schema still validates every response locally
 * (see callGroqStructured), and a response that breaks any constraint is rejected.
 */

/** The only keywords that may remain in the schema sent to Groq. */
export const GROQ_ALLOWED_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "description"]);

/** Constraint keywords enforced locally by zod and described to the model instead. */
const HINT_KEYWORDS = ["pattern", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "format"];

/** Keywords that carry no constraint and are dropped. */
const DROP_KEYWORDS = new Set(["$schema", "$id", "title", "default", "examples"]);

export class GroqSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqSchemaError";
  }
}

type Json = Record<string, unknown>;

const MAX_PATTERN_ENUM = 36;

/**
 * Exact single-character patterns, optionally with a fixed literal prefix, are expanded into an
 * enum so the model is constrained by the schema itself, e.g. "^[a-d]$" → ["a","b","c","d"],
 * "^c[1-6]$" → ["c1",…,"c6"]. Anything else (quantifiers, alternation, several classes,
 * escapes) returns null and stays a description hint. zod still validates the original pattern.
 */
export function patternToEnum(pattern: string): string[] | null {
  const m = /^\^([A-Za-z0-9_]*)\[([A-Za-z0-9-]+)\]\$$/.exec(pattern);
  if (!m) return null;
  const [, prefix, cls] = m as unknown as [string, string, string];
  const chars: string[] = [];
  for (let i = 0; i < cls.length; i++) {
    const a = cls[i]!;
    if (cls[i + 1] === "-" && i + 2 < cls.length) {
      const b = cls[i + 2]!;
      const from = a.charCodeAt(0);
      const to = b.charCodeAt(0);
      const sameKind = (/[a-z]/.test(a) && /[a-z]/.test(b)) || (/[A-Z]/.test(a) && /[A-Z]/.test(b)) || (/[0-9]/.test(a) && /[0-9]/.test(b));
      if (!sameKind || to < from) return null;
      for (let c = from; c <= to; c++) chars.push(String.fromCharCode(c));
      i += 2;
    } else if (a === "-") {
      return null; // a literal "-" is ambiguous; keep it as a hint
    } else {
      chars.push(a);
    }
  }
  const unique = [...new Set(chars)];
  if (unique.length === 0 || unique.length > MAX_PATTERN_ENUM) return null;
  return unique.map((c) => prefix + c);
}

function transform(node: unknown, path: string): Json {
  if (!node || typeof node !== "object" || Array.isArray(node)) throw new GroqSchemaError(`${path}: expected a schema object`);
  const src = node as Json;
  const out: Json = {};
  const hints: string[] = [];

  for (const [key, value] of Object.entries(src)) {
    if (DROP_KEYWORDS.has(key)) continue;
    if (HINT_KEYWORDS.includes(key)) {
      hints.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      continue;
    }
    switch (key) {
      case "type":
      case "required":
      case "enum":
        out[key] = value;
        break;
      case "description":
        out.description = value;
        break;
      case "const":
        // A literal (e.g. the exercise "type" discriminator) → single-value enum.
        out.enum = [value];
        break;
      case "properties": {
        const props: Json = {};
        for (const [name, child] of Object.entries(value as Json)) props[name] = transform(child, `${path}.${name}`);
        out.properties = props;
        break;
      }
      case "items":
        out.items = transform(value, `${path}[]`);
        break;
      case "anyOf":
      case "oneOf":
        // oneOf (zod discriminated unions) → anyOf. Branches stay mutually exclusive via their enum discriminator.
        if (!Array.isArray(value)) throw new GroqSchemaError(`${path}: ${key} must be an array`);
        out.anyOf = value.map((b, i) => transform(b, `${path}|${i}`));
        break;
      case "additionalProperties":
        if (value !== false) throw new GroqSchemaError(`${path}: additionalProperties must be false`);
        break; // re-set below for every object
      default:
        // $ref, allOf, not, if/then, patternProperties, ... are not documented for strict mode.
        throw new GroqSchemaError(`${path}: unsupported JSON Schema keyword "${key}"`);
    }
  }

  if (out.type === "string" && typeof src.pattern === "string" && out.enum === undefined) {
    const values = patternToEnum(src.pattern);
    if (values) {
      out.enum = values;
      const i = hints.findIndex((h) => h.startsWith("pattern: "));
      if (i >= 0) hints.splice(i, 1);
    }
  }

  if (out.type === "object") {
    const props = (out.properties ?? {}) as Json;
    const declared = new Set((src.required as string[] | undefined) ?? []);
    const missing = Object.keys(props).filter((p) => !declared.has(p));
    // Strict mode has no optional fields. Making one required would change what the model must send,
    // so refuse instead of silently changing the contract.
    if (missing.length) throw new GroqSchemaError(`${path}: optional properties are not supported in strict mode: ${missing.join(", ")}`);
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  if (hints.length) {
    const hint = `Constraints: ${hints.join("; ")}.`;
    out.description = out.description ? `${out.description} ${hint}` : hint;
  }
  return out;
}

/** Throws GroqSchemaError if any keyword outside GROQ_ALLOWED_KEYWORDS remains. */
export function assertGroqStrictSchema(schema: unknown, path = "$"): void {
  if (!schema || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema as Json)) {
    if (!GROQ_ALLOWED_KEYWORDS.has(key)) throw new GroqSchemaError(`${path}: keyword "${key}" is not allowed`);
    if (key === "properties") for (const [n, c] of Object.entries(value as Json)) assertGroqStrictSchema(c, `${path}.${n}`);
    if (key === "items") assertGroqStrictSchema(value, `${path}[]`);
    if (key === "anyOf") (value as unknown[]).forEach((b, i) => assertGroqStrictSchema(b, `${path}|${i}`));
  }
}

const cache = new WeakMap<z.ZodType, Json>();

/** zod schema → Groq strict JSON Schema (cached; throws GroqSchemaError if it cannot be represented). */
export function toGroqStrictSchema(schema: z.ZodType): Json {
  const hit = cache.get(schema);
  if (hit) return hit;
  const raw = z.toJSONSchema(schema, { io: "output", unrepresentable: "throw" });
  const out = transform(raw, "$");
  assertGroqStrictSchema(out);
  cache.set(schema, out);
  return out;
}
