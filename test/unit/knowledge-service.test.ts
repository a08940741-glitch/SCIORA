import { test } from "node:test";
import assert from "node:assert/strict";
import { KnowledgeService } from "../../src/knowledge/service.ts";
import type { KnowledgeProvider, KnowledgeAnswerInput } from "../../src/knowledge/provider.ts";
import type { SourceRetriever } from "../../src/knowledge/retriever.ts";
import { NoopRetriever } from "../../src/knowledge/retriever.ts";
import { ProviderError } from "../../src/ai/provider.ts";
import { fakeSource, sampleKnowledgeAnswer } from "../helpers/knowledge.ts";

function stubProvider(simulated: boolean, impl?: (i: KnowledgeAnswerInput) => Promise<any>) {
  const calls: KnowledgeAnswerInput[] = [];
  const p: KnowledgeProvider = {
    name: simulated ? "demo" : "anthropic",
    simulated,
    models: simulated ? null : { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
    async answer(input) {
      calls.push(input);
      if (impl) return impl(input);
      return { answer: sampleKnowledgeAnswer(), meta: { source: simulated ? "demo" : "anthropic", simulated, model: simulated ? null : "claude-sonnet-5-5", fallbackUsed: false, generatedAt: "t" } };
    },
    async transform() {
      throw new Error("not used");
    },
  };
  return { p, calls };
}

function fakeRetriever(impl: SourceRetriever["search"]) {
  const calls: { q: string; opts: any }[] = [];
  const r: SourceRetriever = {
    name: "fake-test-retriever",
    enabled: true,
    async search(q, opts) {
      calls.push({ q, opts });
      return impl(q, opts);
    },
  };
  return { r, calls };
}

const REQ = { question: "شنو هو التركيب الضوئي؟", level: "intermediate" as const, language: "darija" as const };

test("demo provider: retriever is never called; note = demo", async () => {
  const { p } = stubProvider(true);
  const { r, calls } = fakeRetriever(async () => [fakeSource()]);
  const d = await new KnowledgeService({ provider: p, retriever: r }).draft(REQ);
  assert.equal(calls.length, 0);
  assert.equal(d.retrieval.note, "demo");
  assert.equal(d.retrieval.performed, false);
  assert.deepEqual(d.retrieval.sources, []);
});

test("live provider + default NoopRetriever (D1): no retrieval, note = disabled, provider gets no sources", async () => {
  const { p, calls } = stubProvider(false);
  const d = await new KnowledgeService({ provider: p }).draft(REQ);
  assert.equal(d.retrieval.note, "disabled");
  assert.equal(d.retrieval.performed, false);
  assert.deepEqual(calls[0]!.sources, []);
  assert.equal(new NoopRetriever().enabled, false);
});

test("live provider + enabled fake retriever: sources get server ids S1..Sn and reach the provider", async () => {
  const { p, calls } = stubProvider(false);
  const { r, calls: rc } = fakeRetriever(async () => [fakeSource(), fakeSource({ url: "https://example.org/2" })]);
  const d = await new KnowledgeService({ provider: p, retriever: r, now: () => 0 }).draft(REQ);
  assert.equal(rc[0]!.q, REQ.question);
  assert.equal(rc[0]!.opts.limit, 5);
  assert.deepEqual(d.retrieval.sources.map((s) => s.id), ["S1", "S2"]);
  assert.equal(d.retrieval.sources[0]!.retriever, "fake-test-retriever");
  assert.equal(d.retrieval.sources[0]!.retrievedAt, new Date(0).toISOString());
  assert.equal(d.retrieval.performed, true);
  assert.equal(calls[0]!.sources.length, 2);
});

test("retriever failure: answer continues without sources, note = failed", async () => {
  const { p, calls } = stubProvider(false);
  const { r } = fakeRetriever(async () => {
    throw new Error("network down");
  });
  const d = await new KnowledgeService({ provider: p, retriever: r }).draft(REQ);
  assert.equal(d.retrieval.note, "failed");
  assert.deepEqual(calls[0]!.sources, []);
});

test("retriever timeout: aborted, answer continues without sources, note = timeout", async () => {
  const { p } = stubProvider(false);
  let aborted = false;
  const { r } = fakeRetriever(
    (_q, opts) =>
      new Promise((resolve) => {
        opts.signal.addEventListener("abort", () => {
          aborted = true;
        });
        setTimeout(() => resolve([fakeSource()]), 1000);
      }),
  );
  const d = await new KnowledgeService({ provider: p, retriever: r, retrievalTimeoutMs: 30 }).draft(REQ);
  assert.equal(d.retrieval.note, "timeout");
  assert.equal(aborted, true);
  assert.deepEqual(d.retrieval.sources, []);
});

test("retriever returning malformed items: invalid ones dropped; none left → no_results", async () => {
  const { p } = stubProvider(false);
  const { r } = fakeRetriever(async () => [{ title: "x", url: "javascript:alert(1)" } as any, { nonsense: true } as any]);
  const d = await new KnowledgeService({ provider: p, retriever: r }).draft(REQ);
  assert.equal(d.retrieval.note, "no_results");
  assert.deepEqual(d.retrieval.sources, []);
});

test("more than 5 retrieved sources are capped at 5", async () => {
  const { p } = stubProvider(false);
  const { r } = fakeRetriever(async () => Array.from({ length: 9 }, (_, i) => fakeSource({ url: `https://example.org/${i}` })));
  const d = await new KnowledgeService({ provider: p, retriever: r }).draft(REQ);
  assert.equal(d.retrieval.sources.length, 5);
});

test("provider errors propagate unchanged (route maps them to HTTP)", async () => {
  const { p } = stubProvider(false, async () => {
    throw new ProviderError("rate_limited", "busy", 7);
  });
  await assert.rejects(new KnowledgeService({ provider: p }).draft(REQ), (e: unknown) => e instanceof ProviderError && e.code === "rate_limited");
});
