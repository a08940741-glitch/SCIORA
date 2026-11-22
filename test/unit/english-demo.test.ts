import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoLessonFile, DemoProvider, loadDemoContent } from "../../src/ai/demo-provider.ts";
import { DemoKnowledgeFile, DemoKnowledgeProvider, loadKnowledgeDemo } from "../../src/knowledge/demo-provider.ts";
import { DemoEvidenceFile, DemoEvidenceProvider, loadEvidenceDemo } from "../../src/evidence/provider.ts";
import { findNonEnglishOutput } from "../../src/domain/english-only.ts";
import type { ShortTextExercise } from "../../src/domain/schemas.ts";

/** SCIORA is English-only: every demo lesson, answer and claim analysis must be English. */

// ------------------------------------------------------------- Learning Assistant

test("demo lessons: 5 English-only lessons that pass the English output validator", () => {
  const files = loadDemoContent();
  assert.equal(files.length, 5);
  for (const f of files) {
    assert.equal(findNonEnglishOutput(f.lesson), null, `${f.id} contains non-English text`);
    assert.ok(f.matchKeywords.every((k) => /^[\x20-\x7E]+$/.test(k)), `${f.id}: match keywords must be plain English`);
  }
});

test("demo lessons: keywords cover every written-exercise criterion", () => {
  for (const f of loadDemoContent()) {
    for (const e of f.lesson.exercises) {
      if (e.type !== "short_text") continue;
      for (const c of e.rubric.criteria) assert.ok((f.demoKeywords[e.id]?.[c.id]?.length ?? 0) > 0, `${f.id}/${e.id}/${c.id}`);
    }
  }
});

test("demo loader: strict — the old bilingual fields (lessonEn, demoKeywordsEn) are now rejected", () => {
  const f = loadDemoContent()[0]!;
  assert.equal(DemoLessonFile.safeParse(f).success, true);
  assert.equal(DemoLessonFile.safeParse({ ...f, lessonEn: f.lesson }).success, false);
  assert.equal(DemoLessonFile.safeParse({ ...f, demoKeywordsEn: f.demoKeywords }).success, false);
  assert.equal(DemoLessonFile.safeParse({ ...f, lesson: { ...f.lesson, confidence: "certain" } }).success, false, "fully validated");
});

test("generateLesson: English lesson for an English question; no language notices exist any more", async () => {
  const p = new DemoProvider();
  const en = await p.generateLesson({ question: "Explain photosynthesis", level: "school", language: "en" });
  assert.equal(en.lesson.understood.topic, "Photosynthesis");
  assert.ok(en.lesson.explanationSimple.length > 0);
  assert.equal(findNonEnglishOutput(en.lesson), null);
  assert.deepEqual(en.notices, ["demo_content", "content_unreviewed"]);
});

test("topics(): each demo topic title matches its own lesson", () => {
  const p = new DemoProvider();
  assert.deepEqual(
    p.topics().map((t) => t.topic),
    ["Photosynthesis", "The Pythagorean theorem", "Expanding and the distributive property", "The principle of inertia (Newton's first law)", "The water cycle"],
  );
  for (const t of p.topics()) assert.equal(p.findLesson(t.topic)?.id, t.id, `chip "${t.topic}"`);
});

test("judgeWritten: English answer → criteria met, English feedback; a missed keyword stays 'unclear', never 'not_met'", async () => {
  const p = new DemoProvider();
  const lesson = (await p.generateLesson({ question: "water cycle", level: "school", language: "en" })).lesson;
  const q3 = lesson.exercises.find((e) => e.id === "q3") as ShortTextExercise;
  const input = { exercise: q3, language: "en" as const, subject: "general_science" as const, level: "school" as const };
  const ok = await p.judgeWritten({ ...input, answer: "Water evaporates, condenses into clouds, falls as rain and returns to the sea as runoff." });
  assert.ok(ok.judgement.criteria.every((c) => c.judgement === "met"));
  assert.equal(findNonEnglishOutput(ok.judgement), null);
  const vague = await p.judgeWritten({ ...input, answer: "Things move around a lot." });
  assert.ok(vague.judgement.criteria.every((c) => c.judgement === "unclear"));
});

// ------------------------------------------------------------- Knowledge Explorer

test("demo knowledge: English-only answers and transforms, no citations (D1)", () => {
  for (const f of loadKnowledgeDemo()) {
    assert.equal(f.answer.understood.detectedLanguage, "en");
    assert.ok(f.answer.segments.every((s) => s.sourceIds.length === 0));
    assert.equal(findNonEnglishOutput({ a: f.answer, t: f.transforms }), null, `${f.id} contains non-English text`);
  }
  const f = loadKnowledgeDemo()[0]!;
  assert.equal(DemoKnowledgeFile.safeParse({ ...f, answerEn: f.answer }).success, false, "old bilingual field rejected");
});

test("knowledge: English question → English answer and transforms; topic chips match their own files", async () => {
  const p = new DemoKnowledgeProvider();
  const a = await p.answer({ request: { question: "What is photosynthesis?", level: "intermediate", language: "en" }, sources: [] });
  assert.equal(a.answer.understood.topic, "Photosynthesis");
  const t = await p.transform({ mode: "simplify", level: "intermediate", language: "en", content: { topic: a.answer.understood.topic, summary: a.answer.summary, points: [] } });
  assert.equal(findNonEnglishOutput(t.output), null);
  for (const topic of p.topics()) assert.equal(p.find(topic.topic)?.id, topic.id, `chip "${topic.topic}"`);
});

// ------------------------------------------------------------- Evidence Analyzer

test("demo evidence: English-only analyses; each claim chip matches its own file", async () => {
  const p = new DemoEvidenceProvider();
  for (const f of loadEvidenceDemo()) {
    assert.equal(f.analysis.understood.detectedLanguage, "en");
    assert.ok(f.analysis.subClaims.every((s) => s.evidence.length === 0), "D1: no evidence in demo");
    assert.equal(findNonEnglishOutput(f.analysis), null, `${f.id} contains non-English text`);
  }
  for (const c of p.claims()) {
    assert.equal(p.find(c.claim)?.id, c.id, `chip "${c.claim}"`);
    const r = await p.analyze({ request: { claim: c.claim, language: "en" }, sources: [] });
    assert.equal(r.analysis.understood.detectedLanguage, "en");
  }
  const f = loadEvidenceDemo()[0]!;
  assert.equal(DemoEvidenceFile.safeParse({ ...f, analysisEn: f.analysis }).success, false, "old bilingual field rejected");
});
