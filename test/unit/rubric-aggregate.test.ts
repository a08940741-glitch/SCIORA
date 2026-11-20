import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, evidenceAppearsInAnswer } from "../../src/domain/rubric-aggregate.ts";
import type { Rubric, WrittenJudgement } from "../../src/domain/schemas.ts";

const rubric: Rubric = {
  criteria: [
    { id: "light", description: "sunlight is the energy source", weight: 1, required: true },
    { id: "inputs", description: "water and carbon dioxide", weight: 1, required: true },
    { id: "oxygen", description: "oxygen is released", weight: 1, required: false },
  ],
  acceptedExamples: ["x"],
  misconceptions: [{ id: "soil_food", description: "plants eat soil" }],
  languageSensitive: false,
};
const ANSWER = "النباتات كتصاوب الماكلة ديالها بالضو ديال الشمس والما وثاني أكسيد الكربون";

function j(criteria: WrittenJudgement["criteria"], extra: Partial<WrittenJudgement> = {}): WrittenJudgement {
  return { criteria, misconceptionId: null, feedback: "f", confidence: "high", ...extra };
}

test("all required met → correct (optional unmet lowers score only)", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو ديال الشمس" },
    { criterionId: "inputs", judgement: "met", evidence: "والما وثاني أكسيد الكربون" },
    { criterionId: "oxygen", judgement: "not_met", evidence: null },
  ]), ANSWER);
  assert.equal(r.verdict, "correct");
  assert.equal(r.score, 0.67);
});

test("some required met → partially_correct with score", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو ديال الشمس" },
    { criterionId: "inputs", judgement: "not_met", evidence: null },
    { criterionId: "oxygen", judgement: "not_met", evidence: null },
  ]), ANSWER);
  assert.equal(r.verdict, "partially_correct");
  assert.equal(r.score, 0.33);
});

test("partial judgement on a required criterion → partially_correct", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو" },
    { criterionId: "inputs", judgement: "partial", evidence: "والما" },
  ]), ANSWER);
  // oxygen is optional and missing (→ unclear), which must not affect the verdict.
  assert.equal(r.verdict, "partially_correct");
  assert.equal(r.score, 0.5);
});

test("all required clearly not_met → incorrect, misconception mapped", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "not_met", evidence: null },
    { criterionId: "inputs", judgement: "not_met", evidence: null },
    { criterionId: "oxygen", judgement: "not_met", evidence: null },
  ], { misconceptionId: "soil_food" }), "النبات كياكل من التراب");
  assert.equal(r.verdict, "incorrect");
  assert.equal(r.score, 0);
  assert.equal(r.misconception, "plants eat soil");
});

test("fabricated evidence → criterion downgraded to unclear → uncertain (never correct)", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "ضوء الشمس هو مصدر الطاقة" }, // not in answer
    { criterionId: "inputs", judgement: "met", evidence: "والما وثاني أكسيد الكربون" },
    { criterionId: "oxygen", judgement: "not_met", evidence: null },
  ]), ANSWER);
  assert.equal(r.verdict, "uncertain");
  assert.equal(r.score, null);
  assert.equal(r.criteria[0]!.judgement, "unclear");
  assert.match(r.criteria[0]!.downgradedReason ?? "", /evidence not found/);
  assert.match(r.uncertaintyReason ?? "", /sunlight/);
});

test("met without any evidence → unclear → uncertain", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: null },
    { criterionId: "inputs", judgement: "met", evidence: "والما" },
  ]), ANSWER);
  assert.equal(r.verdict, "uncertain");
});

test("required criterion explicitly unclear → uncertain", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "unclear", evidence: null },
    { criterionId: "inputs", judgement: "met", evidence: "والما" },
  ]), ANSWER);
  assert.equal(r.verdict, "uncertain");
});

test("criterion missing from AI output → unclear → uncertain", () => {
  const r = aggregate(rubric, j([{ criterionId: "light", judgement: "met", evidence: "بالضو" }]), ANSWER);
  assert.equal(r.verdict, "uncertain");
  assert.equal(r.criteria[1]!.downgradedReason, "not judged");
});

test("low AI confidence → uncertain even if all met", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو" },
    { criterionId: "inputs", judgement: "met", evidence: "والما" },
  ], { confidence: "low" }), ANSWER);
  assert.equal(r.verdict, "uncertain");
  assert.match(r.uncertaintyReason ?? "", /low confidence/);
});

test("unclear OPTIONAL criterion does not make the verdict uncertain", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو" },
    { criterionId: "inputs", judgement: "met", evidence: "والما" },
    { criterionId: "oxygen", judgement: "unclear", evidence: null },
  ]), ANSWER);
  assert.equal(r.verdict, "correct");
});

test("unknown criterion ids from the AI are ignored", () => {
  const r = aggregate(rubric, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو" },
    { criterionId: "inputs", judgement: "met", evidence: "والما" },
    { criterionId: "invented", judgement: "not_met", evidence: null },
  ]), ANSWER);
  assert.equal(r.verdict, "correct");
  assert.equal(r.criteria.length, 3);
});

test("evidence check tolerates tashkeel, alef forms and punctuation differences", () => {
  assert.equal(evidenceAppearsInAnswer("أكسيد الكربون", "ثاني اكسيد الكربون."), true);
  assert.equal(evidenceAppearsInAnswer("الضَّو", "بالضو ديال الشمس"), true);
  assert.equal(evidenceAppearsInAnswer("   ", "anything"), false);
  assert.equal(evidenceAppearsInAnswer("القمر", "بالضو ديال الشمس"), false);
});

test("rubric with no required criteria treats all criteria as required", () => {
  const r2: Rubric = { ...rubric, criteria: rubric.criteria.map((c) => ({ ...c, required: false })) };
  const r = aggregate(r2, j([
    { criterionId: "light", judgement: "met", evidence: "بالضو" },
    { criterionId: "inputs", judgement: "met", evidence: "والما" },
    { criterionId: "oxygen", judgement: "not_met", evidence: null },
  ]), ANSWER);
  assert.equal(r.verdict, "partially_correct");
});
