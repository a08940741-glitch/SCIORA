import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { DemoKnowledgeProvider, loadKnowledgeDemo } from "../../src/knowledge/demo-provider.ts";
import { AnthropicKnowledgeProvider } from "../../src/knowledge/anthropic-provider.ts";
import { createKnowledgeProvider } from "../../src/knowledge/index.ts";
import { KNOWLEDGE_SYSTEM_PROMPT } from "../../src/knowledge/prompts.ts";
import { FALLBACK_BETA } from "../../src/ai/structured-call.ts";
import { ProviderError } from "../../src/ai/provider.ts";
import { loadConfig } from "../../src/config.ts";
import { fakeClient, okResponse } from "../helpers/fake-client.ts";
import { sampleKnowledgeAnswer } from "../helpers/knowledge.ts";

const MODELS = { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" };
const REQ = { question: "شنو هو التركيب الضوئي؟", level: "intermediate" as const, language: "darija" as const };
const CONTENT = { topic: "التركيب الضوئي", summary: "النباتات كتصاوب الماكلة بالضو", points: [] as string[] };

// ================================================================= demo

test("demo knowledge content: 5 valid files, unreviewed, ZERO sources/citations anywhere (D1)", () => {
  const files = loadKnowledgeDemo();
  assert.equal(files.length, 5);
  for (const f of files) {
    assert.equal(f.reviewed, false);
    for (const s of f.answer.segments) assert.deepEqual(s.sourceIds, [], `${f.id} has a citation`);
    const raw = JSON.stringify(f);
    assert.equal(/https?:\/\//.test(raw), false, `${f.id} contains a URL`);
    for (const q of f.transforms.quiz.questions) assert.ok(q.choices.some((c) => c.id === q.correctChoiceId), `${f.id} quiz answer missing`);
    assert.ok(f.answer.connections.length > 0);
    assert.ok(f.answer.segments.some((s) => s.kind === "uncertainty" || s.kind === "assumption"), `${f.id} should show an uncertainty/assumption`);
  }
});

test("demo matches Darija, MSA, French, English and Arabizi questions", async () => {
  const p = new DemoKnowledgeProvider();
  const cases: [string, string][] = [
    ["شنو هو التركيب الضوئي؟", "photosynthesis"],
    ["explique la photosynthèse", "photosynthesis"],
    ["What is photosynthesis?", "photosynthesis"],
    ["chno howa tarkib daw2i", "photosynthesis"],
    ["kifach n7seb b fitagors", "pythagoras"],
    ["What is the water cycle", "water-cycle"],
    ["dawrat lma kifach katkhdem", "water-cycle"],
    ["c'est quoi le principe d'inertie", "inertia"],
    ["كيفاش ننشر تعبير", "distributivity"],
  ];
  for (const [q, id] of cases) assert.equal(p.find(q)?.id, id, q);
});

test("demo answer: labelled demo, DEMO caveat first, no sources even if a citation sneaks into content", async () => {
  const files = loadKnowledgeDemo();
  (files[0]!.answer.segments[0] as any).sourceIds = ["S1"]; // simulate a bad content edit
  const p = new DemoKnowledgeProvider(files);
  const out = await p.answer({ request: REQ, sources: [] });
  assert.equal(out.meta.source, "demo");
  assert.equal(out.meta.simulated, true);
  assert.equal(out.meta.model, null);
  assert.ok(out.notices?.includes("demo_content"));
  assert.ok(out.answer.segments.every((s) => s.sourceIds.length === 0));
});

test("demo answer: other language / level → honest caveats in Darija", async () => {
  // French has no demo version → served in Darija with an honest notice.
  const out = await new DemoKnowledgeProvider().answer({ request: { ...REQ, language: "fr", level: "advanced" }, sources: [] });
  assert.ok(out.notices?.includes("demo_language_fixed"));
  assert.ok(out.notices?.includes("demo_level_fixed"));
});

test("demo: unknown topic → not_in_demo (404), never invented content", async () => {
  await assert.rejects(new DemoKnowledgeProvider().answer({ request: { ...REQ, question: "شكون ربح كاس العالم؟" }, sources: [] }), (e: unknown) => e instanceof ProviderError && e.code === "not_in_demo" && e.httpStatus === 404);
});

test("demo transforms: simplify / examples / quiz for a known topic", async () => {
  const p = new DemoKnowledgeProvider();
  for (const mode of ["simplify", "examples", "quiz"] as const) {
    const out = await p.transform({ mode, level: "intermediate", language: "darija", content: CONTENT });
    assert.equal(out.output.mode, mode);
    assert.equal(out.meta.simulated, true);
  }
  await assert.rejects(p.transform({ mode: "quiz", level: "intermediate", language: "darija", content: { topic: "zzz", summary: "qqq", points: [] } }), ProviderError);
});

// ================================================================= live provider (fake client)

test("live answer: LEARN model, medium effort, fallback, fixed system prompt, question + empty-sources notice", async () => {
  const { client, calls } = fakeClient([okResponse(sampleKnowledgeAnswer(), "claude-sonnet-5-5")]);
  const out = await new AnthropicKnowledgeProvider({ client, models: MODELS }).answer({ request: REQ, sources: [] });
  const p = calls[0]!.params;
  assert.equal(p.model, "claude-sonnet-5-5");
  assert.equal(p.output_config.effort, "medium");
  assert.deepEqual(p.betas, [FALLBACK_BETA]);
  assert.equal(p.system, KNOWLEDGE_SYSTEM_PROMPT);
  assert.match(p.messages[0].content, /<student_question>\nشنو هو التركيب الضوئي؟\n<\/student_question>/);
  assert.match(p.messages[0].content, /NO SOURCES WERE RETRIEVED/);
  assert.equal(out.meta.source, "anthropic");
  assert.equal(out.meta.simulated, false);
});

test("live transform: FAST model (Haiku), low effort, mode-specific schema", async () => {
  const quiz = { title: "t", questions: [{ question: "q", choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correctChoiceId: "a", explanation: "e" }], caveats: [] };
  const { client, calls } = fakeClient([okResponse(quiz, "claude-haiku-5-5")]);
  const out = await new AnthropicKnowledgeProvider({ client, models: MODELS }).transform({ mode: "quiz", level: "beginner", language: "fr", content: CONTENT });
  assert.equal(calls[0]!.params.model, "claude-haiku-5-5");
  assert.equal(calls[0]!.params.output_config.effort, "low");
  assert.equal(calls[0]!.params.fallbacks, undefined);
  assert.equal(out.output.mode, "quiz");
});

test("live provider error handling is the shared Phase 1 behaviour (refusal, malformed, 429, unavailable)", async () => {
  const run = (step: any) => new AnthropicKnowledgeProvider({ client: fakeClient([step]).client, models: MODELS }).answer({ request: REQ, sources: [] });
  await assert.rejects(run({ stop_reason: "refusal", parsed_output: null, model: "m" }), (e: any) => e.code === "refusal");
  await assert.rejects(run(okResponse({ broken: true }, "m")), (e: any) => e.code === "bad_output");
  await assert.rejects(run(new Anthropic.RateLimitError(429, {}, "r", new Headers({ "retry-after": "9" }))), (e: any) => e.code === "rate_limited" && e.retryAfterSec === 9);
  await assert.rejects(run(new Anthropic.APIConnectionTimeoutError({ message: "timeout" })), (e: any) => e.code === "unavailable");
});

// ================================================================= factory

test("factory: demo config never creates a client; live config uses the factory (fake)", () => {
  let created = 0;
  const demo = createKnowledgeProvider(loadConfig({ ANTHROPIC_API_KEY: "test-key-not-real" }), () => {
    created++;
    throw new Error("must not be called");
  });
  assert.equal(demo.simulated, true);
  assert.equal(created, 0);
  const live = createKnowledgeProvider(loadConfig({ SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real" }), () => fakeClient([]).client);
  assert.equal(live.simulated, false);
  assert.deepEqual(live.models, MODELS);
});
