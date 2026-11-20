import { FORBIDDEN_PUBLIC_KEYS } from "../../src/domain/schemas.ts";

/** Returns every path in `value` whose key is a forbidden (answer-key) field name. */
export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((FORBIDDEN_PUBLIC_KEYS as readonly string[]).includes(k)) hits.push(`${path}.${k}`);
      hits.push(...findForbiddenKeys(v, `${path}.${k}`));
    }
  }
  return hits;
}

/** True if any string inside `value` (or the serialized whole) contains `needle`. */
export function containsText(value: unknown, needle: string): boolean {
  return JSON.stringify(value).includes(needle);
}
