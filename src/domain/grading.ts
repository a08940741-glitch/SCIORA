import { create, all, type MathNode } from "mathjs";
import type { ExpressionExercise, McqExercise, NumericExercise } from "./schemas.ts";
import { normalizeAnswer } from "./normalize.ts";

/**
 * Deterministic (rule-based) grading. No AI involved.
 *
 * Rule: a deterministic check may say "correct". It says "incorrect" ONLY when it parsed
 * the student's answer with certainty. Anything it cannot parse is returned as "unparsed"
 * and goes to the rubric/AI layer — never straight to "incorrect".
 */
export type DeterministicOutcome =
  | { kind: "correct" }
  | { kind: "incorrect" }
  | { kind: "unparsed"; reason: string };

// ------------------------------------------------------------------ MCQ

export function isValidChoice(ex: McqExercise, answer: string): boolean {
  return resolveChoiceId(ex, answer) !== null;
}

function resolveChoiceId(ex: McqExercise, answer: string): string | null {
  const a = normalizeAnswer(answer);
  const byId = ex.choices.find((c) => c.id.toLowerCase() === a);
  if (byId) return byId.id;
  const byText = ex.choices.find((c) => normalizeAnswer(c.text) === a);
  return byText ? byText.id : null;
}

export function gradeMcq(ex: McqExercise, answer: string): DeterministicOutcome {
  const id = resolveChoiceId(ex, answer);
  if (id === null) return { kind: "unparsed", reason: "not one of the choices" };
  return id === ex.correctChoiceId ? { kind: "correct" } : { kind: "incorrect" };
}

// ------------------------------------------------------------------ numeric

const NUM = String.raw`[-+]?(?:\d+(?:\.\d+)?|\.\d+)`;
const RE_DECIMAL_COMMA = /^([-+]?\d+),(\d+)$/;
const RE_NUMBER = new RegExp(`^${NUM}$`);
const RE_FRACTION = new RegExp(`^(${NUM})\\s*/\\s*(${NUM})$`);
const RE_PERCENT = new RegExp(`^(${NUM})\\s*%$`);

/**
 * Parses a numeric answer. Accepts: "0.5", ".5", "0,5", "٠٫٥", "1/2", "½", "x = 0.5",
 * "50%" (only if allowPercent), and a trailing unit equal to the exercise unit.
 * Returns null when it cannot be sure.
 */
export function parseNumericAnswer(raw: string, opts: { allowPercent: boolean; unit: string | null }): number | null {
  let s = normalizeAnswer(raw);
  // "x = 0.5" / "س = 0.5" / "answer: 0.5"
  const eq = s.match(/^[\p{L}]{1,12}\s*[=:]\s*(.+)$/u);
  if (eq) s = eq[1]!.trim();
  if (opts.unit) {
    const u = normalizeAnswer(opts.unit);
    if (u && s.endsWith(u)) s = s.slice(0, -u.length).trim();
  }
  s = s.replace(/\s+/g, "");
  const dc = s.match(RE_DECIMAL_COMMA);
  if (dc) s = `${dc[1]}.${dc[2]}`;

  if (RE_NUMBER.test(s)) return Number(s);
  const fr = s.match(RE_FRACTION);
  if (fr) {
    const d = Number(fr[2]);
    if (d === 0) return null;
    return Number(fr[1]) / d;
  }
  const pc = s.match(RE_PERCENT);
  if (pc) return opts.allowPercent ? Number(pc[1]) / 100 : null;
  return null;
}

export function gradeNumeric(ex: NumericExercise, answer: string): DeterministicOutcome {
  const v = parseNumericAnswer(answer, { allowPercent: ex.allowPercent, unit: ex.unit });
  if (v === null || !Number.isFinite(v)) return { kind: "unparsed", reason: "could not read a number" };
  return Math.abs(v - ex.answer) <= ex.tolerance + 1e-9 ? { kind: "correct" } : { kind: "incorrect" };
}

// ------------------------------------------------------------------ expression (mathjs, sandboxed)

const math = create(all!);
const parseExpr = math.parse; // keep a private reference

const ALLOWED_FUNCTIONS = new Set(["sqrt", "abs"]);
const ALLOWED_CONSTANTS = new Set(["pi", "e"]);
/** OperatorNode.fn holds the function NAME (op holds the symbol). */
const ALLOWED_OPS = new Set(["add", "subtract", "multiply", "divide", "pow", "unaryMinus", "unaryPlus"]);
const MAX_EXPR_CHARS = 200;
const MAX_NODES = 120;

/** Parses and validates against a strict whitelist. Returns null if anything is not allowed. */
function safeParse(expr: string, variables: string[]): MathNode | null {
  if (expr.length === 0 || expr.length > MAX_EXPR_CHARS) return null;
  let node: MathNode;
  try {
    node = parseExpr(expr);
  } catch {
    return null;
  }
  let count = 0;
  let ok = true;
  node.traverse((n: MathNode, _path: string, parent: MathNode | null) => {
    count++;
    switch (n.type) {
      case "ConstantNode": {
        const v = (n as unknown as { value: unknown }).value;
        if (typeof v !== "number") ok = false;
        break;
      }
      case "SymbolNode": {
        const name = (n as unknown as { name: string }).name;
        const isFnName = parent?.type === "FunctionNode" && (parent as unknown as { fn: MathNode }).fn === n;
        if (isFnName) {
          if (!ALLOWED_FUNCTIONS.has(name)) ok = false;
        } else if (!variables.includes(name) && !ALLOWED_CONSTANTS.has(name)) ok = false;
        break;
      }
      case "OperatorNode":
        if (!ALLOWED_OPS.has((n as unknown as { fn: string }).fn)) ok = false;
        break;
      case "ParenthesisNode":
        break;
      case "FunctionNode": {
        const fn = (n as unknown as { fn: MathNode }).fn;
        if (fn.type !== "SymbolNode" || !ALLOWED_FUNCTIONS.has((fn as unknown as { name: string }).name)) ok = false;
        break;
      }
      default:
        ok = false;
    }
  });
  return ok && count <= MAX_NODES ? node : null;
}

/** Deterministic PRNG so grading is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prepareExpression(raw: string): string {
  let s = normalizeAnswer(raw); // superscripts already converted to ^2 / ^3
  // "y = 2x+2" → "2x+2"
  const eq = s.match(/^[a-z]\s*=\s*(.+)$/);
  if (eq) s = eq[1]!;
  return s;
}

export type Equivalence = "equivalent" | "not_equivalent" | "unknown";

/** Compares two expressions by evaluating them at several random points. */
export function compareExpressions(studentRaw: string, reference: string, variables: string[]): Equivalence {
  const a = safeParse(prepareExpression(studentRaw), variables);
  const b = safeParse(prepareExpression(reference), variables);
  if (!a || !b) return "unknown";
  const fa = a.compile();
  const fb = b.compile();
  const rnd = mulberry32(0x5c10a);
  let valid = 0;
  for (let i = 0; i < 24 && valid < 10; i++) {
    const scope: Record<string, number> = {};
    for (const v of variables) scope[v] = Math.round((rnd() * 10 - 5) * 1000) / 1000 || 0.37;
    let va: unknown, vb: unknown;
    try {
      va = fa.evaluate(scope);
      vb = fb.evaluate(scope);
    } catch {
      continue;
    }
    if (typeof va !== "number" || typeof vb !== "number" || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
    valid++;
    const diff = Math.abs(va - vb);
    if (diff > 1e-6 * Math.max(1, Math.abs(va), Math.abs(vb))) return "not_equivalent";
  }
  return valid >= 6 ? "equivalent" : "unknown";
}

export function gradeExpression(ex: ExpressionExercise, answer: string): DeterministicOutcome {
  const r = compareExpressions(answer, ex.answer, ex.variables);
  if (r === "equivalent") return { kind: "correct" };
  if (r === "not_equivalent") return { kind: "incorrect" };
  return { kind: "unparsed", reason: "could not read the expression" };
}
