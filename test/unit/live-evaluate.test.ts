import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvidence, checkGrading, checkKnowledge, checkLesson, summarize } from "../../scripts/live-evaluate.ts";
import { sampleLesson } from "../helpers/sample-lesson.ts";
import type { KnowledgeQueryResponse } from "../../src/knowledge/schemas.ts";
import type { EvidenceResponse } from "../../src/evidence/schemas.ts";

/** The live-test checks must FAIL on bad or demo output — otherwise a first live test could "pass" falsely. */
const LIVE_META = { source: "groq" as const, simulated: false, model: "openai/gpt-oss-120b", fallbackUsed: false, generatedAt: "2026-11-21T00:00:00Z" };
const DEMO_META = { ...LIVE_META, source: "demo" as const, simulated: true, model: null };

function englishLesson() {
  const l = sampleLesson();
  return { ...l, explanationSimple: "Plants use light.", explanationFormal: "Photosynthesis converts light energy.", steps: ["Light is absorbed."], exercises: l.exercises.slice(0, 3).concat(l.exercises.filter((e) => e.type === "short_text")).slice(-3) };
}

test("lesson checks: live English lesson with 3 exercises passes; demo meta, Arabic text or dropped exercises fail", () => {
  const ok = checkLesson({ lesson: englishLesson(), meta: LIVE_META }, [], "en");
  assert.equal(summarize(ok).ok, true, ok.filter((c) => !c.pass).map((c) => c.name).join("; "));
  assert.equal(summarize(checkLesson({ lesson: englishLesson(), meta: DEMO_META }, [], "en")).ok, false, "demo output must not pass a live test");
  assert.equal(summarize(checkLesson({ lesson: { ...englishLesson(), explanationSimple: "النبات كيستعمل الضو" }, meta: LIVE_META }, [], "en")).ok, false);
  assert.equal(summarize(checkLesson({ lesson: englishLesson(), meta: LIVE_META }, ["q2: broken"], "en")).ok, false);
});

test("grading checks: a wrong answer marked 'correct' FAILS; a correct answer marked 'incorrect' FAILS", () => {
  assert.equal(summarize(checkGrading("correct", "incorrect", "m")).ok, true);
  assert.equal(summarize(checkGrading("uncertain", "uncertain", "m")).ok, true, "uncertain is honest, allowed");
  assert.equal(summarize(checkGrading("correct", "correct", "m")).ok, false);
  assert.equal(summarize(checkGrading("incorrect", "incorrect", "m")).ok, false);
  assert.equal(summarize(checkGrading("correct", "incorrect", null)).ok, false, "must be graded by a live model");
});

function knowledge(overrides: Partial<KnowledgeQueryResponse> = {}): KnowledgeQueryResponse {
  return {
    answer: { understood: { topic: "Photosynthesis", isEducational: true, clarification: null, detectedLanguage: "en" }, title: "Photosynthesis", summary: "Plants make food from light.", segments: [{ kind: "fact", text: "Plants use light.", sourceIds: ["S1"] }], keyConcepts: [], confidence: "medium", caveats: [] },
    sources: [{ id: "S1", title: "Photosynthesis", url: "https://en.wikipedia.org/wiki/Photosynthesis", publisher: "Wikipedia", excerpt: "Photosynthesis is a process used by plants.", publishedAt: null, lastModified: null, retrievedAt: "2026-11-21T00:00:00Z", retriever: "wikipedia", language: "en" } as any],
    verification: { status: "source_backed", retrievalPerformed: true, retriever: "wikipedia", retrievalNote: null, sourcesUsed: 1, uncitedFacts: 0, removedCitations: 0 },
    connections: [],
    meta: LIVE_META,
    notices: [],
    ...overrides,
  } as KnowledgeQueryResponse;
}

test("knowledge checks: valid source-backed answer passes; a citation to an unknown source or demo status fails", () => {
  assert.equal(summarize(checkKnowledge(knowledge(), "en")).ok, true);
  const unknown = knowledge();
  unknown.answer.segments[0]!.sourceIds = ["S9"];
  assert.equal(summarize(checkKnowledge(unknown, "en")).ok, false);
  assert.equal(summarize(checkKnowledge(knowledge({ verification: { ...knowledge().verification, status: "demo" } }), "en")).ok, false);
  const backedWithoutCitation = knowledge();
  backedWithoutCitation.answer.segments[0]!.sourceIds = [];
  assert.equal(summarize(checkKnowledge(backedWithoutCitation, "en")).ok, false, "'source_backed' without a citation must fail");
});

function evidence(quote: string, withSources = true): EvidenceResponse {
  const src = knowledge().sources[0]!;
  return {
    understood: { claimRestated: "Water boils at 100 °C everywhere.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    overall: { verdict: "insufficient_evidence", checkableSubClaims: 1 },
    subClaims: [{ id: "c1", text: "Water boils at 100 °C everywhere.", type: "factual", verdict: "supported", evidence: quote ? [{ sourceId: "S1", stance: "supports", quote }] : [], missingEvidence: "x", backgroundNote: null } as any],
    sources: withSources ? [src] : [],
    basis: { kind: "retrieved_sources", retrievalPerformed: true, retriever: "wikipedia", retrievalNote: null, evidenceItems: 1, removedEvidence: 0 },
    caveats: [],
    meta: LIVE_META,
    notices: [],
  } as EvidenceResponse;
}

test("evidence checks: a quote found in the source passes; an invented quote or evidence without sources fails", () => {
  assert.equal(summarize(checkEvidence(evidence("a process used by plants"))).ok, true);
  assert.equal(summarize(checkEvidence(evidence("water boils everywhere at 100"))).ok, false, "invented quote");
  assert.equal(summarize(checkEvidence(evidence("a process used by plants", false))).ok, false, "evidence with no retrieved source");
  assert.equal(summarize(checkEvidence({ ...evidence(""), meta: DEMO_META })).ok, false, "demo output must not pass");
});
