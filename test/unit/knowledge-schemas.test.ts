import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GeneratedKnowledgeAnswer,
  KnowledgeQueryRequest,
  QuizOutput,
  RetrievedSource,
  TransformRequest,
} from "../../src/knowledge/schemas.ts";
import { sampleKnowledgeAnswer } from "../helpers/knowledge.ts";

test("knowledge query: defaults, trimming, limits, strictness", () => {
  const ok = KnowledgeQueryRequest.parse({ question: "  What is photosynthesis? " });
  assert.equal(ok.level, "intermediate");
  assert.equal(ok.language, "en");
  assert.equal(ok.question, "What is photosynthesis?");
  for (const bad of [{}, { question: "ab" }, { question: "x".repeat(1001) }, { question: "valid?", level: "school" }, { question: "valid?", language: "de" }, { question: "valid?", x: 1 }]) {
    assert.equal(KnowledgeQueryRequest.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 40));
  }
});

test("knowledge query is English-only: 'en' accepted (and the default); every other language value rejected", () => {
  assert.equal(KnowledgeQueryRequest.safeParse({ question: "What is photosynthesis?", language: "en" }).success, true);
  for (const language of ["darija", "msa", "fr", "ar", "es"]) {
    assert.equal(KnowledgeQueryRequest.safeParse({ question: "What is photosynthesis?", language }).success, false, language);
  }
});

test("AI answer schema: valid sample passes", () => {
  assert.equal(GeneratedKnowledgeAnswer.safeParse(sampleKnowledgeAnswer()).success, true);
});

test("AI answer schema has NO way to carry source titles or URLs", () => {
  const withUrl = sampleKnowledgeAnswer() as any;
  withUrl.segments[0].sourceIds = ["https://example.org/fake"];
  assert.equal(GeneratedKnowledgeAnswer.safeParse(withUrl).success, false, "URL as source id rejected");
  const withTitle = sampleKnowledgeAnswer() as any;
  withTitle.segments[0].sourceIds = ["Smith et al. 2020"];
  assert.equal(GeneratedKnowledgeAnswer.safeParse(withTitle).success, false, "citation text as source id rejected");
  // Extra fields such as "references" are stripped by the schema, never passed through.
  const extra = { ...sampleKnowledgeAnswer(), references: [{ title: "Invented", url: "https://x.org" }] };
  const parsed = GeneratedKnowledgeAnswer.parse(extra) as Record<string, unknown>;
  assert.equal("references" in parsed, false);
});

test("segment kinds are restricted to fact / explanation / assumption / uncertainty", () => {
  const a = sampleKnowledgeAnswer() as any;
  a.segments[0].kind = "proven_truth";
  assert.equal(GeneratedKnowledgeAnswer.safeParse(a).success, false);
});

test("transform request: modes, strict content, limits", () => {
  const base = { mode: "quiz", content: { topic: "t", summary: "s", points: ["p"] } };
  assert.equal(TransformRequest.safeParse(base).success, true);
  assert.equal(TransformRequest.safeParse({ ...base, mode: "grade" }).success, false);
  assert.equal(TransformRequest.safeParse({ ...base, content: { ...base.content, html: "<b>" } }).success, false);
  assert.equal(TransformRequest.safeParse({ ...base, content: { topic: "t", summary: "x".repeat(1201) } }).success, false);
  assert.equal(TransformRequest.safeParse({ ...base, content: { topic: "t", summary: "s", points: Array(13).fill("p") } }).success, false);
  assert.deepEqual(TransformRequest.parse({ mode: "simplify", content: { topic: "t", summary: "s" } }).content.points, []);
});

test("quiz output: choice ids a-d only", () => {
  const q = { title: "t", questions: [{ question: "q", choices: [{ id: "a", text: "x" }, { id: "e", text: "y" }], correctChoiceId: "a", explanation: "e" }], caveats: [] };
  assert.equal(QuizOutput.safeParse(q).success, false);
});

test("retrieved source schema requires a real URL", () => {
  const s = { title: "T", url: "not a url", publisher: null, publishedAt: null, excerpt: "e", language: "ar" };
  assert.equal(RetrievedSource.safeParse(s).success, false);
  assert.equal(RetrievedSource.safeParse({ ...s, url: "https://example.org/a" }).success, true);
});
