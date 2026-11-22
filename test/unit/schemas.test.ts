import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GeneratedLesson,
  GradeRequest,
  LessonRequest,
  toPublicLesson,
  WrittenJudgement,
} from "../../src/domain/schemas.ts";
import { sampleLesson, SECRET_MARKERS } from "../helpers/sample-lesson.ts";
import { containsText, findForbiddenKeys } from "../helpers/leak.ts";

test("sample lesson satisfies the GeneratedLesson schema", () => {
  assert.equal(GeneratedLesson.safeParse(sampleLesson()).success, true);
});

test("public view contains no answer-key fields (deep key scan)", () => {
  const pub = toPublicLesson(sampleLesson());
  assert.deepEqual(findForbiddenKeys(pub), []);
});

test("public view contains none of the sealed marker strings", () => {
  const pub = toPublicLesson(sampleLesson());
  for (const m of SECRET_MARKERS) assert.equal(containsText(pub, m), false, `leaked ${m}`);
});

test("public view keeps what students need: prompts, choices, hints", () => {
  const pub = toPublicLesson(sampleLesson());
  assert.equal(pub.exercises.length, 4);
  const mcq = pub.exercises[0]!;
  assert.equal(mcq.type, "mcq");
  if (mcq.type === "mcq") assert.equal(mcq.choices.length, 3);
  assert.ok(pub.exercises.every((e) => e.prompt && e.hint));
});

test("public view ignores extra fields injected into sealed objects (whitelist)", () => {
  const l = sampleLesson() as any;
  l.exercises[0].secretExtra = "INJECTED_ZETA";
  const pub = toPublicLesson(l);
  assert.equal(containsText(pub, "INJECTED_ZETA"), false);
});

test("LessonRequest: defaults, trimming and limits", () => {
  const ok = LessonRequest.parse({ question: "  What is photosynthesis?  " });
  assert.equal(ok.level, "school");
  assert.equal(ok.language, "en");
  assert.equal(ok.question, "What is photosynthesis?");
  for (const language of ["darija", "msa", "fr"]) assert.equal(LessonRequest.safeParse({ question: "valid?", language }).success, false, `English-only: ${language} rejected`);
  assert.equal(LessonRequest.safeParse({ question: "ab" }).success, false);
  assert.equal(LessonRequest.safeParse({ question: "x".repeat(1001) }).success, false);
  assert.equal(LessonRequest.safeParse({ question: "valid?", level: "genius" }).success, false);
  assert.equal(LessonRequest.safeParse({ question: "valid?", extra: 1 }).success, false, "unknown fields rejected");
  assert.equal(LessonRequest.safeParse({ question: 42 }).success, false);
});

test("GradeRequest: limits and strictness", () => {
  const base = { token: "x".repeat(20), exerciseId: "q1", answer: "a" };
  assert.equal(GradeRequest.safeParse(base).success, true);
  assert.equal(GradeRequest.safeParse({ ...base, answer: "   " }).success, false);
  assert.equal(GradeRequest.safeParse({ ...base, answer: "x".repeat(2001) }).success, false);
  assert.equal(GradeRequest.safeParse({ ...base, exerciseId: "../etc" }).success, false);
  assert.equal(GradeRequest.safeParse({ ...base, token: "x".repeat(24001) }).success, false);
  assert.equal(GradeRequest.safeParse({ ...base, isCorrect: true }).success, false);
});

test("WrittenJudgement schema rejects unknown judgement values", () => {
  const bad = { criteria: [{ criterionId: "a", judgement: "probably", evidence: null }], misconceptionId: null, feedback: "f", confidence: "high" };
  assert.equal(WrittenJudgement.safeParse(bad).success, false);
});
