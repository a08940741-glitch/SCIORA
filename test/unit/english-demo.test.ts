import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoLessonFile, DemoProvider, loadDemoContent } from "../../src/ai/demo-provider.ts";
import { DemoKnowledgeFile, DemoKnowledgeProvider, loadKnowledgeDemo } from "../../src/knowledge/demo-provider.ts";
import { DemoEvidenceProvider, loadEvidenceDemo } from "../../src/evidence/provider.ts";
import type { ShortTextExercise } from "../../src/domain/schemas.ts";

/**
 * English demo content (default English experience). Each English version must mirror the
 * Darija version's structure exactly, so grading, tokens and the UI behave identically.
 */

const ARABIC = /[؀-ۿ]/;

/** Recursively collects every string in a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// ------------------------------------------------------------- Learning Assistant

test("english lessons: every demo topic has a validated English version", () => {
  const files = loadDemoContent();
  assert.equal(files.length, 5);
  for (const f of files) assert.ok(f.lessonEn && f.demoKeywordsEn, `${f.id} lacks an English version`);
});

test("english lessons mirror the Darija version: same exercise ids, types, answers and rubric criteria", () => {
  for (const f of loadDemoContent()) {
    const ar = f.lesson;
    const en = f.lessonEn!;
    assert.equal(en.understood.subject, ar.understood.subject, f.id);
    assert.deepEqual(en.exercises.map((e) => [e.id, e.type]), ar.exercises.map((e) => [e.id, e.type]), f.id);
    for (const [i, e] of en.exercises.entries()) {
      const a = ar.exercises[i]!;
      if (e.type === "mcq" && a.type === "mcq") {
        assert.equal(e.correctChoiceId, a.correctChoiceId, `${f.id}/${e.id}`);
        assert.deepEqual(e.choices.map((c) => c.id), a.choices.map((c) => c.id), `${f.id}/${e.id}`);
      } else if (e.type === "numeric" && a.type === "numeric") {
        assert.equal(e.answer, a.answer);
        assert.equal(e.unit, a.unit);
        assert.equal(e.tolerance, a.tolerance);
      } else if (e.type === "expression" && a.type === "expression") {
        assert.equal(e.answer, a.answer);
        assert.deepEqual(e.variables, a.variables);
      } else if (e.type === "short_text" && a.type === "short_text") {
        assert.deepEqual(
          e.rubric.criteria.map((c) => [c.id, c.weight, c.required]),
          a.rubric.criteria.map((c) => [c.id, c.weight, c.required]),
          `${f.id}/${e.id}`,
        );
        assert.deepEqual(e.rubric.misconceptions.map((m) => m.id), a.rubric.misconceptions.map((m) => m.id));
      } else {
        assert.fail(`${f.id}/${e.id}: type mismatch`);
      }
    }
  }
});

test("english lessons: student-facing text is English (no Arabic script)", () => {
  for (const f of loadDemoContent()) {
    const en = f.lessonEn!;
    // acceptedExamples intentionally include Arabic/French examples (multilingual grading reference, never shown).
    const visible = {
      ...en,
      exercises: en.exercises.map((e) => (e.type === "short_text" ? { ...e, rubric: { ...e.rubric, acceptedExamples: [] } } : e)),
    };
    const bad = strings(visible).filter((s) => ARABIC.test(s));
    assert.deepEqual(bad, [], `${f.id} has Arabic in its English lesson`);
  }
});

test("english keywords cover every written-exercise criterion", () => {
  for (const f of loadDemoContent()) {
    for (const e of f.lessonEn!.exercises) {
      if (e.type !== "short_text") continue;
      for (const c of e.rubric.criteria) {
        assert.ok((f.demoKeywordsEn![e.id]?.[c.id]?.length ?? 0) > 0, `${f.id}/${e.id}/${c.id} has no English keywords`);
      }
    }
  }
});

test("lesson loader: lessonEn without demoKeywordsEn (or the reverse) is rejected; unknown keys still rejected", () => {
  const f = loadDemoContent()[0]!;
  const { demoKeywordsEn, ...noKeywords } = f;
  assert.equal(DemoLessonFile.safeParse(noKeywords).success, false);
  const { lessonEn, ...noLesson } = f;
  assert.equal(DemoLessonFile.safeParse(noLesson).success, false);
  const { lessonEn: _l, demoKeywordsEn: _k, ...neither } = f;
  assert.equal(DemoLessonFile.safeParse(neither).success, true, "both optional fields may be absent together");
  assert.equal(DemoLessonFile.safeParse({ ...f, lessonFr: f.lesson }).success, false, "strict: unknown keys rejected");
  assert.equal(DemoLessonFile.safeParse({ ...f, lessonEn: { ...f.lessonEn, confidence: "certain" } }).success, false, "lessonEn is fully validated");
  void demoKeywordsEn;
  void lessonEn;
});

test("generateLesson: English request → English lesson, no language notice; Darija unchanged; French → honest notice", async () => {
  const p = new DemoProvider();
  const en = await p.generateLesson({ question: "Explain photosynthesis", level: "school", language: "en" });
  assert.equal(en.lesson.understood.topic, "Photosynthesis");
  assert.equal(en.notices?.includes("demo_language_fixed"), false);
  assert.equal(ARABIC.test(en.lesson.explanationDarija), false);

  const ar = await p.generateLesson({ question: "شنو هو التركيب الضوئي؟", level: "school", language: "darija" });
  assert.ok(ARABIC.test(ar.lesson.understood.topic));
  assert.equal(ar.notices?.includes("demo_language_fixed"), false);

  const fr = await p.generateLesson({ question: "la photosynthèse", level: "school", language: "fr" });
  assert.ok(fr.notices?.includes("demo_language_fixed"));
});

test("topics(): each demo topic exposes its English title", () => {
  const topics = new DemoProvider().topics();
  assert.deepEqual(
    topics.map((t) => t.topicEn),
    ["Photosynthesis", "The Pythagorean theorem", "Expanding and the distributive property", "The principle of inertia (Newton's first law)", "The water cycle"],
  );
});

test("judgeWritten: English answer to an English exercise → criteria met, English feedback", async () => {
  const p = new DemoProvider();
  const lesson = (await p.generateLesson({ question: "water cycle", level: "school", language: "en" })).lesson;
  const q3 = lesson.exercises.find((e) => e.id === "q3") as ShortTextExercise;
  const out = await p.judgeWritten({
    exercise: q3,
    answer: "Water evaporates, condenses into clouds, falls as rain and returns to the sea as runoff.",
    language: "en",
    subject: "general_science",
    level: "school",
  });
  assert.ok(out.judgement.criteria.every((c) => c.judgement === "met"));
  assert.equal(ARABIC.test(out.judgement.feedback), false);
});

test("judgeWritten: a missed keyword stays 'unclear', never 'not_met', in English too", async () => {
  const p = new DemoProvider();
  const lesson = (await p.generateLesson({ question: "inertia", level: "school", language: "en" })).lesson;
  const q3 = lesson.exercises.find((e) => e.id === "q3") as ShortTextExercise;
  const out = await p.judgeWritten({ exercise: q3, answer: "Things like to keep doing what they do.", language: "en", subject: "physics", level: "school" });
  assert.ok(out.judgement.criteria.every((c) => c.judgement === "unclear"));
  assert.equal(ARABIC.test(out.judgement.feedback), false);
});

// ------------------------------------------------------------- Knowledge Explorer

test("knowledge: every demo file has a validated English answer and transforms, with no citations (D1)", () => {
  for (const f of loadKnowledgeDemo()) {
    assert.ok(f.answerEn && f.transformsEn, `${f.id} lacks an English version`);
    assert.equal(f.answerEn.understood.detectedLanguage, "en");
    assert.ok(f.answerEn.segments.every((s) => s.sourceIds.length === 0));
    assert.deepEqual(strings({ a: f.answerEn, t: f.transformsEn }).filter((s) => ARABIC.test(s)), [], `${f.id} has Arabic in English content`);
    assert.equal(f.transformsEn.quiz.questions.length, f.transforms.quiz.questions.length, f.id);
  }
});

test("knowledge loader: answerEn without transformsEn is rejected", () => {
  const f = loadKnowledgeDemo()[0]!;
  const { transformsEn, ...rest } = f;
  assert.equal(DemoKnowledgeFile.safeParse(rest).success, false);
  void transformsEn;
});

test("knowledge: English request → English answer and transforms; Darija unchanged", async () => {
  const p = new DemoKnowledgeProvider();
  const en = await p.answer({ request: { question: "What is photosynthesis?", level: "intermediate", language: "en" }, sources: [] });
  assert.equal(en.answer.understood.topic, "Photosynthesis");
  assert.equal(en.notices.includes("demo_language_fixed"), false);
  const t = await p.transform({ mode: "simplify", level: "intermediate", language: "en", content: { topic: en.answer.understood.topic, summary: en.answer.summary, points: [] } });
  assert.equal(t.output.mode, "simplify");
  assert.equal(ARABIC.test(strings(t.output).join(" ")), false);

  const ar = await p.answer({ request: { question: "شنو هو التركيب الضوئي؟", level: "intermediate", language: "darija" }, sources: [] });
  assert.ok(ARABIC.test(ar.answer.summary));
  assert.ok(p.topics().every((x) => x.topicEn && !ARABIC.test(x.topicEn)));
});

// ------------------------------------------------------------- Evidence Analyzer

test("evidence: every demo claim has an English analysis mirroring the Darija sub-claims", () => {
  for (const f of loadEvidenceDemo()) {
    assert.ok(f.analysisEn, `${f.id} lacks an English version`);
    assert.deepEqual(f.analysisEn.subClaims.map((s) => [s.id, s.type]), f.analysis.subClaims.map((s) => [s.id, s.type]), f.id);
    assert.ok(f.analysisEn.subClaims.every((s) => s.evidence.length === 0), "D1: no evidence in demo");
    assert.deepEqual(strings(f.analysisEn).filter((s) => ARABIC.test(s)), [], `${f.id} has Arabic in English content`);
  }
});

test("evidence: each English demo claim (as shown on its chip) matches its own file", async () => {
  const p = new DemoEvidenceProvider();
  for (const c of p.claims()) {
    assert.ok(c.claimEn);
    assert.equal(p.find(c.claimEn)?.id, c.id, `chip "${c.claimEn}" must match ${c.id}`);
    const r = await p.analyze({ request: { claim: c.claimEn, language: "en" }, sources: [] });
    assert.equal(r.analysis.understood.detectedLanguage, "en");
    assert.equal(r.notices?.includes("demo_language_fixed"), false);
  }
});

test("knowledge: each English demo topic (as shown on its chip) matches its own file", () => {
  const p = new DemoKnowledgeProvider();
  for (const t of p.topics()) assert.equal(p.find(t.topicEn!)?.id, t.id, `chip "${t.topicEn}"`);
});

test("lessons: each English demo topic (as shown on its chip) matches its own file", () => {
  const p = new DemoProvider();
  for (const t of p.topics()) assert.equal(p.findLesson(t.topicEn!)?.id, t.id, `chip "${t.topicEn}"`);
});

test("English rule feedback, unreadable hints and uncertainty texts contain no Arabic script", async () => {
  const { ruleFeedback, UNREADABLE_HINT, uncertaintyText } = await import("../../src/domain/feedback.ts");
  for (const v of ["correct", "incorrect", "uncertain"] as const) assert.equal(ARABIC.test(ruleFeedback("en", v)), false, v);
  assert.equal(ARABIC.test(UNREADABLE_HINT.en.numeric + UNREADABLE_HINT.en.expression), false);
  assert.equal(uncertaintyText("en", ["Mentions evaporation", "Mentions condensation"]), "SCIORA could not determine: Mentions evaporation; Mentions condensation");
  assert.equal(ARABIC.test(uncertaintyText("en", [])), false);
});
