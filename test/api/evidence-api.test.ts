import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/ai/provider.ts";
import { AnthropicEvidenceProvider, type EvidenceProvider } from "../../src/evidence/provider.ts";
import { EVIDENCE_SYSTEM_PROMPT } from "../../src/evidence/prompts.ts";
import type { SourceRetriever } from "../../src/knowledge/retriever.ts";
import { StubLiveProvider, makeApp, TEST_SECRET_B64 } from "../helpers/app.ts";
import { fakeClient, okResponse } from "../helpers/fake-client.ts";
import { fakeSource } from "../helpers/knowledge.ts";

const analyze = (app: any, payload: object) => app.inject({ method: "POST", url: "/api/evidence/analyze", payload });
const ORBIT = fakeSource({ excerpt: "The Earth orbits the Sun once every 365.25 days approximately." });
function liveEvidence(evidence: any[], type = "factual") {
  const a = {
    understood: { claimRestated: "The Sun orbits the Earth.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [{ id: "c1", text: "The Sun orbits the Earth.", type, evidence, missingEvidence: "An astronomy textbook.", backgroundNote: null }],
    caveats: [],
  };
  const fc = fakeClient([okResponse(a, "claude-opus-5-5")]);
  return { provider: new AnthropicEvidenceProvider({ client: fc.client, model: "claude-opus-5-5" }), calls: fc.calls };
}

test("health reports the evidence module (demo, no retrieval, 5 demo claims)", async () => {
  const { app } = await makeApp();
  const b = (await app.inject({ url: "/api/health" })).json();
  assert.equal(b.evidence.mode, "demo");
  assert.equal(b.evidence.sourceRetrieval, false);
  assert.equal(b.evidence.demoClaims.length, 5);
  assert.equal(b.plannedNotImplemented.includes("evidence_analyzer"), false);
});

test("demo analysis: insufficient_evidence, basis none, no sources, DEMO caveat", async () => {
  const { app } = await makeApp();
  const r = await analyze(app, { claim: "الشمس كتدور على الأرض" });
  const b = r.json();
  assert.equal(r.statusCode, 200);
  assert.equal(b.meta.simulated, true);
  assert.equal(b.overall.verdict, "insufficient_evidence");
  assert.equal(b.basis.kind, "none");
  assert.deepEqual(b.sources, []);
  assert.ok(b.subClaims.every((s: any) => s.evidence.length === 0));
  assert.match(b.caveats[0], /^DEMO:/);
});

test("demo opinion → not_checkable; unknown claim → 404 not_in_demo", async () => {
  const { app } = await makeApp();
  assert.equal((await analyze(app, { claim: "math is the hardest subject" })).json().overall.verdict, "not_checkable");
  const r = await analyze(app, { claim: "unknown claim that matches nothing" });
  assert.equal(r.statusCode, 404);
  assert.equal(r.json().error, "not_in_demo");
});

test("live (fake), no retrieval: invented evidence removed → insufficient_evidence", async () => {
  const { provider } = liveEvidence([{ sourceId: "S1", stance: "contradicts", quote: "The Earth orbits the Sun once" }]);
  const { app } = await makeApp({ evidenceProvider: provider });
  const b = (await analyze(app, { claim: "The Sun orbits the Earth", language: "en" })).json();
  assert.equal(b.meta.simulated, false);
  assert.equal(b.overall.verdict, "insufficient_evidence");
  assert.equal(b.basis.removedEvidence, 1);
  assert.equal(b.basis.retrievalNote, "disabled");
});

test("live (fake) + FAKE retriever: verified quote → contradicted with https source", async () => {
  const { provider } = liveEvidence([{ sourceId: "S1", stance: "contradicts", quote: "The Earth orbits the Sun once every" }]);
  const retriever: SourceRetriever = { name: "fake-test-retriever", enabled: true, search: async () => [ORBIT] };
  const { app } = await makeApp({ evidenceProvider: provider, retriever });
  const b = (await analyze(app, { claim: "The Sun orbits the Earth", language: "en" })).json();
  assert.equal(b.overall.verdict, "contradicted");
  assert.equal(b.basis.kind, "retrieved_sources");
  assert.match(b.sources[0].url, /^https:\/\//);
});

test("live failure → error, never demo content", async () => {
  const p: EvidenceProvider = { name: "anthropic", simulated: false, model: "m", analyze: async () => { throw new ProviderError("unavailable", "down"); } };
  const { app } = await makeApp({ evidenceProvider: p });
  const r = await analyze(app, { claim: "الشمس كتدور على الأرض" });
  assert.equal(r.statusCode, 503);
  assert.equal(r.json().overall, undefined);
});

test("validation: bad bodies → 400; oversized → 413", async () => {
  const { app } = await makeApp();
  for (const p of [{}, { claim: "abc" }, { claim: "x".repeat(1001) }, { claim: "valid claim", language: "de" }, { claim: "valid claim", verdict: "supported" }]) {
    assert.equal((await analyze(app, p)).statusCode, 400, JSON.stringify(p).slice(0, 40));
  }
  assert.equal((await analyze(app, { claim: "x".repeat(40000) })).statusCode, 413);
});

test("no prompt, secret or key in responses; claim text not in logs", async () => {
  const { provider } = liveEvidence([]);
  const { app, logs } = await makeApp({ evidenceProvider: provider, logLevel: "trace", env: { ANTHROPIC_API_KEY: "FAKE_KEY_ZETA_NEVER_SHOWN" } });
  const r = await analyze(app, { claim: "CLAIM_MARKER_ZETA sun orbits", language: "en" });
  for (const n of [EVIDENCE_SYSTEM_PROMPT.slice(0, 60), TEST_SECRET_B64, "FAKE_KEY_ZETA_NEVER_SHOWN", "NO SOURCES WERE RETRIEVED"]) assert.equal(r.body.includes(n), false);
  assert.equal(logs.join("\n").includes("CLAIM_MARKER_ZETA"), false);
});

test("shared daily limit covers evidence calls (live); demo calls are free", async () => {
  const { provider } = liveEvidence([]);
  const live = await makeApp({ provider: new StubLiveProvider(), evidenceProvider: provider, env: { SCIORA_DAILY_LIMIT: "1" } });
  assert.equal((await analyze(live.app, { claim: "The Sun orbits the Earth" })).statusCode, 200);
  const blocked = await live.app.inject({ method: "POST", url: "/api/learn", payload: { question: "شنو هو التركيب الضوئي؟" } });
  assert.equal(blocked.json().error, "daily_limit");
  const demo = await makeApp({ env: { SCIORA_DAILY_LIMIT: "1" } });
  assert.equal((await analyze(demo.app, { claim: "الشمس كتدور على الأرض" })).statusCode, 200);
  assert.equal((await analyze(demo.app, { claim: "الشمس كتدور على الأرض" })).statusCode, 200);
});

test("rate limit and security headers apply", async () => {
  const { app } = await makeApp({ env: { SCIORA_RATE_LIMIT_PER_MINUTE: "2" } });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await analyze(app, { claim: "الشمس كتدور على الأرض" })).statusCode);
  assert.deepEqual(codes, [200, 200, 429]);
  const r = await analyze((await makeApp()).app, { claim: "الشمس كتدور على الأرض" });
  assert.match(String(r.headers["content-security-policy"]), /default-src 'self'/);
});
