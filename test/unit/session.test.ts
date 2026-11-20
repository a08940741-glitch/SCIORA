import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES module.
import { summarizeSession, nextLevel } from "../../public/js/session.js";

const r = (verdict: string, extra: Record<string, unknown> = {}) => ({ verdict, criteria: [], misconception: null, ...extra });

test("not done until every exercise has a result", () => {
  assert.equal(summarizeSession([r("correct")], 3).done, false);
  assert.equal(summarizeSession([r("correct"), r("correct"), r("correct")], 3).done, true);
  assert.equal(summarizeSession([], 0).done, false);
});

test("all graded answers correct → next_level", () => {
  assert.equal(summarizeSession([r("correct"), r("correct"), r("correct")], 3).recommendation, "next_level");
});

test("half or more incorrect → review_first; otherwise retry_same", () => {
  assert.equal(summarizeSession([r("incorrect"), r("incorrect"), r("correct")], 3).recommendation, "review_first");
  assert.equal(summarizeSession([r("correct"), r("partially_correct"), r("correct")], 3).recommendation, "retry_same");
});

test("uncertain results are counted but never drive the recommendation", () => {
  const s = summarizeSession([r("correct"), r("correct"), r("uncertain")], 3);
  assert.equal(s.counts.uncertain, 1);
  assert.equal(s.recommendation, "next_level");
  assert.equal(summarizeSession([r("uncertain"), r("uncertain")], 2).recommendation, "retry_same");
});

test("gaps come only from real results: missing/partial criteria and misconceptions, de-duplicated", () => {
  const s = summarizeSession(
    [
      r("partially_correct", { criteria: [{ description: "mentions water", judgement: "not_met" }, { description: "mentions light", judgement: "met" }] }),
      r("incorrect", { misconception: "plants eat soil", criteria: [{ description: "mentions water", judgement: "partial" }] }),
    ],
    2,
  );
  assert.deepEqual(s.gaps, ["mentions water", "plants eat soil"]);
});

test("next level progression", () => {
  assert.equal(nextLevel("beginner"), "school");
  assert.equal(nextLevel("school"), "intermediate");
  assert.equal(nextLevel("advanced"), "advanced");
});
