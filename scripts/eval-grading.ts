/**
 * LIVE grading evaluation (costs money — owner approval required).
 *
 *   SCIORA_ALLOW_LIVE_TESTS=1 SCIORA_AI_MODE=live ANTHROPIC_API_KEY=... npm run eval:grading
 *
 * Sends every short_text fixture to the FAST model (default Haiku 5.5) through the real
 * live provider (Anthropic or Groq, per SCIORA_AI_PROVIDER), applies SCIORA's server-side aggregation, and compares with the labels.
 * Writes eval-results/grading-<timestamp>.json (git-ignored).
 *
 * Proposed passing bar (Revision 3):
 *   - ZERO correct-category answers graded "incorrect" ("uncertain" is allowed and counted)
 *   - ≥ 90% agreement with the labels overall
 * Caveat: ~28 written cases is a small sample; labels are unreviewed until the owner reviews them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { requireLiveApproval } from "./live-gate.ts";
import { createProvider } from "../src/ai/index.ts";
import { aggregate } from "../src/domain/rubric-aggregate.ts";
import type { ShortTextExercise } from "../src/domain/schemas.ts";
import { CORRECT_CATEGORIES, loadGradingCases, resolveExercise } from "../test/helpers/grading-fixtures.ts";

const config = requireLiveApproval("eval:grading");
const tier = process.env.SCIORA_EVAL_TIER === "learn" ? "learn" : "fast";
const provider = createProvider(config);

const rows: { id: string; category: string; expected: string; got: string; model: string | null; error?: string }[] = [];
for (const c of loadGradingCases()) {
  const { exercise, subject } = resolveExercise(c.exerciseRef);
  if (exercise.type !== "short_text") continue;
  try {
    const out = await provider.judgeWritten(
      { exercise: exercise as ShortTextExercise, answer: c.answer, language: "en", subject: subject as any, level: "school" },
      tier,
    );
    const v = aggregate((exercise as ShortTextExercise).rubric, out.judgement, c.answer).verdict;
    rows.push({ id: c.id, category: c.category, expected: c.expected, got: v, model: out.model });
  } catch (err) {
    rows.push({ id: c.id, category: c.category, expected: c.expected, got: "error", model: null, error: (err as Error).message });
  }
  console.log(`${rows.at(-1)!.id}: expected ${c.expected}, got ${rows.at(-1)!.got}`);
}

const agree = rows.filter((r) => r.got === r.expected).length;
const correctCases = rows.filter((r) => CORRECT_CATEGORIES.has(r.category));
const falseIncorrect = correctCases.filter((r) => r.got === "incorrect");
const uncertain = rows.filter((r) => r.got === "uncertain").length;
const byCategory: Record<string, { n: number; agree: number }> = {};
for (const r of rows) {
  byCategory[r.category] ??= { n: 0, agree: 0 };
  byCategory[r.category]!.n++;
  if (r.got === r.expected) byCategory[r.category]!.agree++;
}
const summary = {
  tier,
  models: provider.models,
  cases: rows.length,
  agreement: rows.length ? agree / rows.length : 0,
  falseIncorrectOnCorrectAnswers: falseIncorrect.length,
  uncertain,
  errors: rows.filter((r) => r.got === "error").length,
  byCategory,
  passesBar: falseIncorrect.length === 0 && rows.length > 0 && agree / rows.length >= 0.9,
  labelsReviewedByOwner: loadGradingCases().every((c) => c.reviewedByStudent),
};
console.log(JSON.stringify(summary, null, 2));
mkdirSync("eval-results", { recursive: true });
writeFileSync(`eval-results/grading-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.passesBar ? 0 : 1);
