import { test } from "node:test";
import assert from "node:assert/strict";
import { GroqProvider } from "../../src/ai/groq-provider.ts";
import { GroqKnowledgeProvider } from "../../src/knowledge/groq-provider.ts";
import { GroqEvidenceProvider } from "../../src/evidence/groq-provider.ts";
import { GroqClient } from "../../src/ai/groq-client.ts";
import type { GeneratedClaimAnalysis } from "../../src/evidence/schemas.ts";
import { allMet, grade, makeApp, STUDENT_ANSWER } from "../helpers/app.ts";
import { FAKE_GROQ_KEY, fakeGroqFetch, groqOk, type GroqStep } from "../helpers/fake-groq.ts";
import { sampleLesson } from "../helpers/sample-lesson.ts";
import { sampleKnowledgeAnswer } from "../helpers/knowledge.ts";
import { findForbiddenKeys, containsText } from "../helpers/leak.ts";

/**
 * Full HTTP pipeline with the Groq providers over a FAKE transport (no network):
 * routes → provider → server-side validation, integrity, verdicts, budgets, redaction.
 */
const MODEL = "openai/gpt-oss-120b";

function groqApp(steps: GroqStep[], env: Record<string, string> = {}) {
  const { fetchFn, calls } = fakeGroqFetch(steps);
  const client = new GroqClient({ apiKey: FAKE_GROQ_KEY, fetch: fetchFn });
  const models = { learn: MODEL, fast: MODEL };
  return makeApp({
    provider: new GroqProvider({ client, models }),
    knowledgeProvider: new GroqKnowledgeProvider({ client, models }),
    evidenceProvider: new GroqEvidenceProvider({ client, model: MODEL }),
    env,
    logLevel: "info",
  }).then((r) => ({ ...r, calls }));
}

function noSecretsIn(text: string) {
  assert.equal(text.includes(FAKE_GROQ_KEY), false, "API key leaked");
  assert.equal(text.includes(`Bearer ${FAKE_GROQ_KEY}`), false, "Authorization header leaked");
}

test("groq health: live mode, provider 'groq', Groq models; no key anywhere in the response", async () => {
  const { app } = await groqApp([]);
  const res = await app.inject({ url: "/api/health" });
  const b = res.json();
  assert.equal(b.mode, "live");
  assert.equal(b.provider, "groq");
  assert.equal(b.simulated, false);
  assert.deepEqual(b.models, { learn: MODEL, fast: MODEL });
  assert.equal(b.knowledge.mode, "live");
  assert.equal(b.evidence.model, MODEL);
  assert.equal(b.demoTopics, null);
  noSecretsIn(res.body);
});

test("groq learning assistant: lesson → sealed token (no answer keys leak) → rule + AI grading; logs hold no key or answer", async () => {
  const { app, logs, calls } = await groqApp([groqOk(sampleLesson()), groqOk(allMet())]);
  const learnRes = await app.inject({ method: "POST", url: "/api/learn", payload: { question: "Explain photosynthesis", language: "en" } });
  assert.equal(learnRes.statusCode, 200);
  const body = learnRes.json();
  assert.equal(body.meta.source, "groq");
  assert.equal(body.meta.model, MODEL);
  assert.deepEqual(findForbiddenKeys(body.lesson), [], "answer keys never reach the browser");
  for (const marker of ["MODEL_ANSWER_ZETA", "RUBRIC_LIGHT_ZETA", "ACCEPTED_EXAMPLE_ZETA"]) assert.equal(containsText(body, marker), false, marker);

  const token = body.exerciseSet.token;
  const mcq = await grade(app, token, "q1", "a");
  assert.equal(mcq.body.result.method, "deterministic", "MCQ graded by rules, no AI call");
  assert.equal(calls.length, 1);

  const written = await grade(app, token, "q4", STUDENT_ANSWER);
  assert.equal(written.res.statusCode, 200);
  assert.equal(written.body.result.verdict, "correct");
  assert.equal(written.body.result.method, "rubric_ai");
  assert.deepEqual(written.body.result.gradedBy, { source: "groq", simulated: false, model: MODEL });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.body.response_format.json_schema.name, "sciora_judgement");

  const allLogs = logs.join("\n");
  noSecretsIn(allLogs);
  assert.equal(allLogs.includes(STUDENT_ANSWER), false, "student answer never logged");
});

test("groq knowledge explorer: invented citation removed by the server; transform works", async () => {
  const citing = { ...sampleKnowledgeAnswer(), segments: sampleKnowledgeAnswer().segments.map((s, i) => (i === 0 ? { ...s, sourceIds: ["S1"] } : s)) };
  const simplify = { title: "Simple", text: "Plants make food from light.", caveats: [] };
  const { app } = await groqApp([groqOk(citing), groqOk(simplify)]);
  const q = (await app.inject({ method: "POST", url: "/api/knowledge/query", payload: { question: "What is photosynthesis?", language: "en" } })).json();
  assert.equal(q.meta.source, "groq");
  assert.equal(q.verification.status, "not_source_verified");
  assert.equal(q.verification.removedCitations, 1);
  assert.deepEqual(q.sources, []);
  const t = await app.inject({
    method: "POST",
    url: "/api/knowledge/transform",
    payload: { mode: "simplify", language: "en", content: { topic: "Photosynthesis", summary: "Plants make food.", points: [] } },
  });
  assert.equal(t.statusCode, 200);
  assert.equal(t.json().mode, "simplify");
  assert.equal(t.json().meta.source, "groq");
});

test("groq evidence analyzer: invented evidence removed; verdict computed by the server", async () => {
  const analysis: GeneratedClaimAnalysis = {
    understood: { claimRestated: "Water boils at 100 °C everywhere.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [
      { id: "c1", text: "Water boils at 100 °C.", type: "factual", evidence: [{ sourceId: "S1", stance: "supports", quote: "invented quote" }], missingEvidence: "A physics reference.", backgroundNote: null },
    ],
    caveats: [],
  };
  const { app } = await groqApp([groqOk(analysis)]);
  const r = (await app.inject({ method: "POST", url: "/api/evidence/analyze", payload: { claim: "Water boils at 100 degrees everywhere", language: "en" } })).json();
  assert.equal(r.meta.source, "groq");
  assert.equal(r.subClaims[0].evidence.length, 0);
  assert.equal(r.subClaims[0].verdict, "insufficient_evidence");
  assert.equal(r.overall.verdict, "insufficient_evidence");
});

test("groq 429 → HTTP 429 with Retry-After; NO demo content substituted; one upstream request", async () => {
  const { app, calls } = await groqApp([{ status: 429, headers: { "retry-after": "20" }, body: { error: { message: "limit" } } }]);
  const res = await app.inject({ method: "POST", url: "/api/learn", payload: { question: "Explain photosynthesis", language: "en" } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "20");
  assert.equal(res.json().error, "rate_limited");
  assert.equal(res.json().lesson, undefined, "never replaced by demo content");
  assert.equal(calls.length, 1);
  noSecretsIn(res.body);
});

test("groq auth failure → 503 misconfigured; the raw provider error and key are not exposed", async () => {
  const { app, logs } = await groqApp([{ status: 401, body: { error: { message: `Invalid API Key ${FAKE_GROQ_KEY}` } } }]);
  const res = await app.inject({ method: "POST", url: "/api/evidence/analyze", payload: { claim: "Water boils at 100 degrees everywhere", language: "en" } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "misconfigured");
  noSecretsIn(res.body);
  noSecretsIn(logs.join("\n"));
  assert.equal(res.body.includes("Invalid API Key"), false);
});

test("daily limit still applies to Groq live calls (shared budget)", async () => {
  const { app, calls } = await groqApp([groqOk(sampleLesson()), groqOk(sampleLesson())], { SCIORA_DAILY_LIMIT: "1" });
  const first = await app.inject({ method: "POST", url: "/api/learn", payload: { question: "Explain photosynthesis", language: "en" } });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({ method: "POST", url: "/api/learn", payload: { question: "Explain photosynthesis", language: "en" } });
  assert.equal(second.statusCode, 503);
  assert.equal(second.json().error, "daily_limit");
  assert.equal(calls.length, 1, "no upstream request once the daily cap is reached");
});
