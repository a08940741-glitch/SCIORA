import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, evidenceAppearsInAnswer } from "../../src/domain/rubric-aggregate.ts";
import { gradeExpression, gradeNumeric } from "../../src/domain/grading.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import type { ShortTextExercise } from "../../src/domain/schemas.ts";
import { CORRECT_CATEGORIES, loadGradingCases, resolveExercise } from "../helpers/grading-fixtures.ts";

/**
 * OFFLINE fixture tests. They prove SCIORA's CODE handles these answers correctly
 * given a well-behaved grader (recordedJudgement). They do NOT prove that Haiku
 * (or any model) produces those judgements — that requires `npm run eval:grading`
 * (live, costs money, owner approval required).
 */

const cases = loadGradingCases();

test("fixture set: ≥30 cases, ≥3 subjects, all required categories present", () => {
  assert.ok(cases.length >= 30, `only ${cases.length} cases`);
  const subjects = new Set(cases.map((c) => resolveExercise(c.exerciseRef).subject));
  assert.ok(subjects.size >= 3, [...subjects].join(","));
  for (const cat of ["darija_correct", "msa_correct", "paraphrase_correct", "math_equivalent", "partial", "incorrect", "unclear"]) {
    assert.ok(cases.some((c) => c.category === cat), `missing category ${cat}`);
  }
});

test("fixture sanity: every met/partial evidence quote really appears in its answer", () => {
  for (const c of cases) {
    for (const j of c.recordedJudgement?.criteria ?? []) {
      if (j.judgement === "met" || j.judgement === "partial") {
        assert.ok(evidenceAppearsInAnswer(j.evidence, c.answer), `${c.id}: evidence "${j.evidence}" not in answer`);
      }
    }
  }
});

test("pipeline: every fixture case produces its expected verdict", () => {
  const failures: string[] = [];
  for (const c of cases) {
    const { exercise } = resolveExercise(c.exerciseRef);
    let got: string;
    if (exercise.type === "short_text") {
      assert.ok(c.recordedJudgement, `${c.id} needs recordedJudgement`);
      got = aggregate(exercise.rubric, c.recordedJudgement!, c.answer).verdict;
    } else if (exercise.type === "numeric" || exercise.type === "expression") {
      const o = exercise.type === "numeric" ? gradeNumeric(exercise, c.answer) : gradeExpression(exercise, c.answer);
      got = o.kind === "unparsed" ? "unreadable" : o.kind;
    } else {
      throw new Error(`unsupported fixture type ${exercise.type}`);
    }
    if (got !== c.expected) failures.push(`${c.id} [${c.category}]: expected ${c.expected}, got ${got}`);
  }
  assert.deepEqual(failures, []);
});

test("pipeline safety: no CORRECT-category answer is ever graded incorrect", () => {
  for (const c of cases.filter((x) => CORRECT_CATEGORIES.has(x.category))) {
    const { exercise } = resolveExercise(c.exerciseRef);
    if (exercise.type === "short_text") {
      assert.notEqual(aggregate(exercise.rubric, c.recordedJudgement!, c.answer).verdict, "incorrect", c.id);
    }
  }
});

test("demo keyword grader safety on fixtures: never 'incorrect', never a false 'correct'", async () => {
  const demo = new DemoProvider();
  const report: string[] = [];
  for (const c of cases) {
    const { exercise, subject } = resolveExercise(c.exerciseRef);
    if (exercise.type !== "short_text") continue;
    const out = await demo.judgeWritten({ exercise: exercise as ShortTextExercise, answer: c.answer, language: "darija", subject: subject as any, level: "school" });
    const v = aggregate((exercise as ShortTextExercise).rubric, out.judgement, c.answer).verdict;
    report.push(`${c.id}: ${v}`);
    assert.notEqual(v, "incorrect", `demo grader said incorrect for ${c.id}`);
    if (v === "correct") assert.equal(c.expected, "correct", `demo grader gave a FALSE correct for ${c.id}`);
  }
  assert.ok(report.length > 20);
});

test("review status is reported honestly (owner review still pending)", () => {
  const unreviewed = cases.filter((c) => !c.reviewedByStudent).length;
  // Not a failure: this documents the current state. Update when the owner reviews labels.
  assert.equal(unreviewed, cases.length);
});
