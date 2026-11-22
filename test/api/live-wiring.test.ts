import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createProvider } from "../../src/ai/index.ts";
import { createKnowledgeProvider } from "../../src/knowledge/index.ts";
import { createEvidenceProvider } from "../../src/evidence/service.ts";
import { GroqClient } from "../../src/ai/groq-client.ts";
import { FAKE_GROQ_KEY, fakeGroqFetch, groqOk } from "../helpers/fake-groq.ts";
import { TEST_SECRET_B64, allMet, STUDENT_ANSWER } from "../helpers/app.ts";
import { sampleLesson } from "../helpers/sample-lesson.ts";
import { sampleKnowledgeAnswer } from "../helpers/knowledge.ts";
import type { GeneratedClaimAnalysis } from "../../src/evidence/schemas.ts";

/**
 * Full live wiring exactly as src/server.ts builds it: environment → loadConfig → the three real
 * factories → buildApp. Only the network transport is fake (no request can reach Groq), and
 * an Anthropic factory that throws proves Anthropic is never touched in Groq mode.
 */
const ANALYSIS: GeneratedClaimAnalysis = {
  understood: { claimRestated: "Water boils at 100 °C everywhere.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
  subClaims: [{ id: "c1", text: "Water boils at 100 °C everywhere.", type: "factual", evidence: [], missingEvidence: "Boiling points at different altitudes.", backgroundNote: null }],
  caveats: [],
};
const BY_SCHEMA: Record<string, unknown> = {
  sciora_lesson: sampleLesson(),
  sciora_judgement: allMet(),
  sciora_knowledge_answer: sampleKnowledgeAnswer(),
  sciora_simplify: { title: "Simple", text: "Plants make food from light.", caveats: [] },
  sciora_claim_analysis: ANALYSIS,
};

async function liveGroqApp(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    SCIORA_TOKEN_SECRET: TEST_SECRET_B64,
    SCIORA_RATE_LIMIT_PER_MINUTE: "10000",
    SCIORA_AI_MODE: "live",
    SCIORA_AI_PROVIDER: "groq",
    GROQ_API_KEY: FAKE_GROQ_KEY,
    SCIORA_RETRIEVER: "none",
    ...extraEnv,
  });
  const { fetchFn, calls } = fakeGroqFetch([
    async (init) => {
      const name = JSON.parse(String(init.body)).response_format.json_schema.name as string;
      const r = groqOk(BY_SCHEMA[name]);
      return new Response(JSON.stringify(r.body), { status: 200 });
    },
  ]);
  const anthropicNever = () => {
    throw new Error("Anthropic factory must not be called in Groq mode");
  };
  const groqFactory = (key: string) => new GroqClient({ apiKey: key, fetch: fetchFn });
  const logs: string[] = [];
  const { app } = await buildApp({
    config,
    provider: createProvider(config, anthropicNever, groqFactory),
    knowledgeProvider: createKnowledgeProvider(config, anthropicNever, groqFactory),
    evidenceProvider: createEvidenceProvider(config, anthropicNever, groqFactory),
    logStream: new Writable({ write: (c, _e, cb) => (logs.push(c.toString()), cb()) }),
    logLevel: "info",
  });
  await app.ready();
  return { app, calls, logs };
}

test("live wiring (Groq): all four AI features go config → factories → app → Groq, with correct provenance", async () => {
  const { app, calls, logs } = await liveGroqApp();

  const health = (await app.inject({ url: "/api/health" })).json();
  assert.deepEqual([health.mode, health.provider, health.knowledge.mode, health.evidence.mode], ["live", "groq", "live", "live"]);

  // Adaptive learning: lesson at the requested level → rule grading → AI rubric grading.
  const lesson = (await app.inject({ method: "POST", url: "/api/learn", payload: { question: "Explain photosynthesis", level: "advanced", language: "en" } })).json();
  assert.equal(lesson.meta.source, "groq");
  assert.match(calls[0]!.body.messages[1].content, /Requested level: advanced/);
  assert.match(calls[0]!.body.messages[1].content, /Response language: English \(en\)/);
  const token = lesson.exerciseSet.token;
  const mcq = (await app.inject({ method: "POST", url: "/api/grade", payload: { token, exerciseId: "q1", answer: "a" } })).json();
  assert.equal(mcq.result.method, "deterministic", "rules, no AI call");
  assert.equal(calls.length, 1);
  const written = (await app.inject({ method: "POST", url: "/api/grade", payload: { token, exerciseId: "q4", answer: STUDENT_ANSWER } })).json();
  assert.equal(written.result.gradedBy.source, "groq");

  // Knowledge Intelligence + learning-mode transform.
  const k = (await app.inject({ method: "POST", url: "/api/knowledge/query", payload: { question: "What is photosynthesis?", language: "en" } })).json();
  assert.equal(k.meta.source, "groq");
  assert.equal(k.verification.status, "not_source_verified", "retrieval disabled → never presented as source-backed");
  const t = (await app.inject({ method: "POST", url: "/api/knowledge/transform", payload: { mode: "simplify", language: "en", content: { topic: "Photosynthesis", summary: "Plants make food.", points: [] } } })).json();
  assert.equal(t.meta.source, "groq");

  // Evidence Intelligence.
  const e = (await app.inject({ method: "POST", url: "/api/evidence/analyze", payload: { claim: "Water boils at 100 degrees everywhere", language: "en" } })).json();
  assert.equal(e.meta.source, "groq");
  assert.equal(e.overall.verdict, "insufficient_evidence");

  assert.deepEqual(
    calls.map((c) => c.body.response_format.json_schema.name),
    ["sciora_lesson", "sciora_judgement", "sciora_knowledge_answer", "sciora_simplify", "sciora_claim_analysis"],
  );
  assert.ok(calls.every((c) => c.url === "https://api.groq.com/openai/v1/chat/completions"));
  const allLogs = logs.join("\n");
  assert.equal(allLogs.includes(FAKE_GROQ_KEY), false);
  assert.equal(allLogs.includes(STUDENT_ANSWER), false);
});

test("live wiring (Groq): the shared daily cap covers every feature (one call, then refused before Groq)", async () => {
  const { app, calls } = await liveGroqApp({ SCIORA_DAILY_LIMIT: "1" });
  assert.equal((await app.inject({ method: "POST", url: "/api/knowledge/query", payload: { question: "What is photosynthesis?", language: "en" } })).statusCode, 200);
  for (const [url, payload] of [
    ["/api/learn", { question: "Explain photosynthesis", language: "en" }],
    ["/api/evidence/analyze", { claim: "Water boils at 100 degrees everywhere", language: "en" }],
    ["/api/knowledge/transform", { mode: "simplify", language: "en", content: { topic: "P", summary: "S", points: [] } }],
  ] as const) {
    const r = await app.inject({ method: "POST", url, payload });
    assert.equal(r.statusCode, 503, url);
    assert.equal(r.json().error, "daily_limit", url);
  }
  assert.equal(calls.length, 1, "no Groq request after the cap");
});
