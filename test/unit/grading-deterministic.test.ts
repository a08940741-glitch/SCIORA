import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer, normalizeForMatch } from "../../src/domain/normalize.ts";
import {
  compareExpressions,
  gradeExpression,
  gradeMcq,
  gradeNumeric,
  isValidChoice,
  parseNumericAnswer,
} from "../../src/domain/grading.ts";
import type { ExpressionExercise, McqExercise, NumericExercise } from "../../src/domain/schemas.ts";

// ---------------------------------------------------------------- normalization

test("normalize: removes tashkeel and tatweel", () => {
  assert.equal(normalizeAnswer("الضَّوْءُ"), normalizeAnswer("الضوء"));
  assert.equal(normalizeAnswer("الشمـــس"), "الشمس");
});

test("normalize: unifies alef forms and alef maksura", () => {
  assert.equal(normalizeAnswer("أكسيد"), normalizeAnswer("اكسيد"));
  assert.equal(normalizeAnswer("إنتاج"), "انتاج");
  assert.equal(normalizeAnswer("آلة"), "الة");
  assert.equal(normalizeAnswer("على"), "علي");
});

test("normalize: Eastern Arabic and Persian digits become 0-9", () => {
  assert.equal(normalizeAnswer("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(normalizeAnswer("۱۲"), "12");
});

test("normalize: Arabic decimal separator, case, spaces, math symbols", () => {
  assert.equal(normalizeAnswer("٠٫٥"), "0.5");
  assert.equal(normalizeAnswer("  Photo   SYNTHÈSE "), "photo synthèse");
  assert.equal(normalizeAnswer("3×4÷2−1"), "3*4/2-1");
});

test("normalizeForMatch: drops punctuation for quote checks", () => {
  assert.equal(normalizeForMatch("«الضوء، والماء!»"), "الضوء والماء");
});

// ---------------------------------------------------------------- MCQ

const mcq: McqExercise = {
  id: "q1", type: "mcq", prompt: "p", hint: "h", explanation: "e",
  choices: [{ id: "a", text: "الضو" }, { id: "b", text: "التراب" }],
  correctChoiceId: "a",
};

test("mcq: by id (case-insensitive) and by exact choice text", () => {
  assert.deepEqual(gradeMcq(mcq, "a"), { kind: "correct" });
  assert.deepEqual(gradeMcq(mcq, "A"), { kind: "correct" });
  assert.deepEqual(gradeMcq(mcq, "b"), { kind: "incorrect" });
  assert.deepEqual(gradeMcq(mcq, "التراب"), { kind: "incorrect" });
  assert.equal(gradeMcq(mcq, "z").kind, "unparsed");
  assert.equal(isValidChoice(mcq, "z"), false);
  assert.equal(isValidChoice(mcq, "a"), true);
});

// ---------------------------------------------------------------- numeric

const num: NumericExercise = {
  id: "q2", type: "numeric", prompt: "p", hint: "h", explanation: "e",
  answer: 0.5, tolerance: 0.01, unit: null, allowPercent: true,
};

test("numeric: 1/2 = 0.5 = ٠٫٥ = x=0.5 = 0,5 = .5 = ½ = 50% (when allowed)", () => {
  for (const a of ["0.5", "1/2", "٠٫٥", "x = 0.5", "س = 0.5", "0,5", ".5", "½", "50%", "١/٢", " 0.50 "]) {
    assert.deepEqual(gradeNumeric(num, a), { kind: "correct" }, a);
  }
});

test("numeric: within tolerance passes, outside fails definitively", () => {
  assert.deepEqual(gradeNumeric(num, "0.49"), { kind: "correct" });
  assert.deepEqual(gradeNumeric(num, "0.4"), { kind: "incorrect" });
  assert.deepEqual(gradeNumeric(num, "2"), { kind: "incorrect" });
});

test("numeric: percent refused when not allowed (→ unparsed, not incorrect)", () => {
  assert.equal(gradeNumeric({ ...num, allowPercent: false }, "50%").kind, "unparsed");
});

test("numeric: unparseable goes to AI layer, never straight to incorrect", () => {
  for (const a of ["نص", "half", "about one half", "1/0", "0.5.5"]) {
    assert.equal(gradeNumeric(num, a).kind, "unparsed", a);
  }
});

test("numeric: matching unit suffix is accepted", () => {
  const withUnit: NumericExercise = { ...num, answer: 5, tolerance: 0, unit: "cm", allowPercent: false };
  assert.deepEqual(gradeNumeric(withUnit, "5 cm"), { kind: "correct" });
  assert.deepEqual(gradeNumeric(withUnit, "5"), { kind: "correct" });
  assert.equal(gradeNumeric(withUnit, "5 km").kind, "unparsed");
  assert.equal(parseNumericAnswer("-3", { allowPercent: false, unit: null }), -3);
});

// ---------------------------------------------------------------- expression

test("expression: equivalent forms are equivalent", () => {
  assert.equal(compareExpressions("2(x+1)", "2*x+2", ["x"]), "equivalent");
  assert.equal(compareExpressions("2x+2", "2*(x+1)", ["x"]), "equivalent");
  assert.equal(compareExpressions("(x-1)(x+1)", "x^2-1", ["x"]), "equivalent");
  assert.equal(compareExpressions("x²−1", "x^2-1", ["x"]), "equivalent");
  assert.equal(compareExpressions("y = 2x + 2", "2*x+2", ["x"]), "equivalent");
  assert.equal(compareExpressions("x/2", "0.5x", ["x"]), "equivalent");
});

test("expression: non-equivalent forms are detected", () => {
  assert.equal(compareExpressions("2x+1", "2*x+2", ["x"]), "not_equivalent");
  assert.equal(compareExpressions("x^2+1", "x^2-1", ["x"]), "not_equivalent");
});

test("expression: unparseable or disallowed input → unknown (goes to AI, not incorrect)", () => {
  for (const a of ["2x+", "import('fs')", "evaluate(\"1\")", "x = = 2", "f(x)", "[1,2]", "\"str\"", "a+b", "x".repeat(300)]) {
    assert.equal(compareExpressions(a, "2*x+2", ["x"]), "unknown", a);
  }
});

test("expression: gradeExpression maps outcomes", () => {
  const ex: ExpressionExercise = { id: "q3", type: "expression", prompt: "p", hint: "h", explanation: "e", answer: "2*x+2", variables: ["x"] };
  assert.deepEqual(gradeExpression(ex, "2(x+1)"), { kind: "correct" });
  assert.deepEqual(gradeExpression(ex, "2x+1"), { kind: "incorrect" });
  assert.equal(gradeExpression(ex, "جوج x زائد جوج").kind, "unparsed");
});
