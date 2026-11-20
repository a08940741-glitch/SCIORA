import { test } from "node:test";
import assert from "node:assert/strict";
import { WikipediaRetriever, chooseWikis, cleanSearchQuery, createRetriever, WikipediaHttpError } from "../../src/knowledge/wikipedia-retriever.ts";
import { sanitizeSources } from "../../src/knowledge/sources.ts";
import { KnowledgeService } from "../../src/knowledge/service.ts";
import { EvidenceService } from "../../src/evidence/service.ts";
import { AnthropicEvidenceProvider } from "../../src/evidence/provider.ts";
import { loadConfig } from "../../src/config.ts";
import { fakeClient, okResponse } from "../helpers/fake-client.ts";
import { sampleKnowledgeAnswer } from "../helpers/knowledge.ts";

/** All tests use a FAKE fetch. No network. */

function page(over: Record<string, unknown> = {}) {
  return {
    pageid: 1,
    ns: 0,
    title: "Photosynthesis",
    index: 1,
    fullurl: "https://en.wikipedia.org/wiki/Photosynthesis",
    extract: "Photosynthesis is a process used by plants to convert light energy into chemical energy.",
    revisions: [{ timestamp: "2026-11-01T10:00:00Z" }],
    ...over,
  };
}
function apiBody(pages: unknown[]) {
  return { batchcomplete: true, query: { pages } };
}
function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}
function fakeFetch(steps: (Response | Error | ((url: string, init: any) => Promise<Response>))[]) {
  const calls: { url: string; init: any }[] = [];
  let i = 0;
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    const s = steps[Math.min(i++, steps.length - 1)]!;
    if (s instanceof Error) throw s;
    if (typeof s === "function") return s(url, init);
    return s.clone();
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const opts = (signal = new AbortController().signal) => ({ language: "en", limit: 3, signal });
const make = (fetchFn: typeof fetch, extra = {}) =>
  new WikipediaRetriever({ userAgent: "SCIORA-Test/1.0 (test)", fetchFn, minIntervalMs: 0, baseBackoffMs: 1, maxRetryAfterMs: 5, ...extra });

// ---------------------------------------------------------------- query building

test("question words are removed from the search text (Darija, MSA, French, English, Arabizi)", () => {
  assert.equal(cleanSearchQuery("شنو هو التركيب الضوئي؟"), "التركيب الضوئي");
  assert.equal(cleanSearchQuery("What is photosynthesis?"), "photosynthesis");
  assert.equal(cleanSearchQuery("C'est quoi la photosynthèse ?"), "la photosynthèse");
  assert.equal(cleanSearchQuery("chno howa tarkib daw2i"), "tarkib daw2i");
  assert.equal(cleanSearchQuery("?"), "?", "never empty");
});

test("wiki choice follows the query script and answer language (max 2 wikis)", () => {
  assert.deepEqual(chooseWikis("التركيب الضوئي", "darija"), ["ar", "en"]);
  assert.deepEqual(chooseWikis("التركيب الضوئي", "fr"), ["ar", "fr"]);
  assert.deepEqual(chooseWikis("photosynthèse", "fr"), ["fr", "en"]);
  assert.deepEqual(chooseWikis("photosynthesis", "darija"), ["en", "fr"]);
});

test("request URL: fixed Wikipedia host, MediaWiki params, query only in the search parameter (no SSRF)", () => {
  const r = make(fakeFetch([]).fn);
  const url = new URL(r.buildUrl("en", "evil.example/../x?y=1", 3));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "en.wikipedia.org");
  assert.equal(url.pathname, "/w/api.php");
  assert.equal(url.searchParams.get("gsrsearch"), "evil.example/../x?y=1");
  assert.equal(url.searchParams.get("maxlag"), "5");
  assert.equal(url.searchParams.get("exintro"), "1");
  assert.equal(url.searchParams.get("explaintext"), "1");
});

// ---------------------------------------------------------------- parsing

test("parses results: real title/URL/excerpt, publishedAt null, lastModified from revision, publisher label", async () => {
  const { fn, calls } = fakeFetch([response(200, apiBody([page()]))]);
  const r = make(fn);
  const out = await r.search("What is photosynthesis?", opts());
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    title: "Photosynthesis",
    url: "https://en.wikipedia.org/wiki/Photosynthesis",
    publisher: "Wikipedia (en)",
    publishedAt: null,
    lastModified: "2026-11-01T10:00:00Z",
    excerpt: "Photosynthesis is a process used by plants to convert light energy into chemical energy.",
    language: "en",
  });
  assert.equal(calls[0]!.init.headers["User-Agent"], "SCIORA-Test/1.0 (test)");
  assert.equal(calls[0]!.init.redirect, "error");
});

test("untrusted response: wrong host, http, missing, disambiguation, non-article and empty extracts are dropped; order by search index", async () => {
  const pages = [
    page({ title: "Second", index: 2, fullurl: "https://en.wikipedia.org/wiki/Second" }),
    page({ title: "First", index: 1, fullurl: "https://en.wikipedia.org/wiki/First" }),
    page({ title: "Evil host", fullurl: "https://evil.example/wiki/X" }),
    page({ title: "Lookalike", fullurl: "https://en.wikipedia.org.evil.example/wiki/X" }),
    page({ title: "HTTP", fullurl: "http://en.wikipedia.org/wiki/X" }),
    page({ title: "Missing", missing: true }),
    page({ title: "Disambig", pageprops: { disambiguation: "" } }),
    page({ title: "Talk", ns: 1 }),
    page({ title: "Empty", extract: "   " }),
  ];
  const r = make(fakeFetch([response(200, apiBody(pages))]).fn);
  const out = await r.search("q", { ...opts(), limit: 5 });
  assert.deepEqual(out.map((s) => s.title), ["First", "Second"]);
});

test("long extracts are capped; results then pass sanitizeSources with server ids", async () => {
  const r = make(fakeFetch([response(200, apiBody([page({ extract: "x".repeat(10000) })]))]).fn);
  const out = await r.search("q", opts());
  assert.equal(out[0]!.excerpt.length, 1500);
  const pub = sanitizeSources(out, "2026-11-20T00:00:00Z", "wikipedia");
  assert.equal(pub[0]!.id, "S1");
  assert.equal(pub[0]!.lastModified, "2026-11-01T10:00:00Z");
  assert.equal(pub[0]!.publishedAt, null);
});

test("no results on the first wiki → second wiki is tried; none → empty list", async () => {
  const { fn, calls } = fakeFetch([response(200, { batchcomplete: true }), response(200, apiBody([page({ fullurl: "https://fr.wikipedia.org/wiki/Photosynth%C3%A8se" })]))]);
  const out = await make(fn).search("photosynthèse", { ...opts(), language: "fr" });
  assert.equal(new URL(calls[0]!.url).hostname, "fr.wikipedia.org");
  assert.equal(new URL(calls[1]!.url).hostname, "en.wikipedia.org");
  assert.equal(out.length, 0, "fr URL is not valid for the en wiki → dropped");
  const empty = fakeFetch([response(200, { batchcomplete: true })]);
  assert.deepEqual(await make(empty.fn).search("zzzz", opts()), []);
});

test("malformed JSON, API error object, unexpected shape and oversized body → errors (degrade upstream)", async () => {
  await assert.rejects(make(fakeFetch([response(200, "not json")]).fn).search("q", opts()), /invalid JSON/);
  await assert.rejects(make(fakeFetch([response(200, { error: { code: "badvalue" } })]).fn).search("q", opts()), /api error/);
  await assert.rejects(make(fakeFetch([response(200, { query: { pages: "nope" } })]).fn).search("q", opts()), /unexpected/);
  await assert.rejects(make(fakeFetch([response(200, "x".repeat(1_000_001))]).fn).search("q", opts()), /too large/);
  await assert.rejects(make(fakeFetch([response(404, "")]).fn).search("q", opts()), (e: unknown) => e instanceof WikipediaHttpError && e.status === 404);
});

// ---------------------------------------------------------------- respectful use

test("429 / 503 / network errors are retried with backoff (max 2 retries), then succeed", async () => {
  const { fn, calls } = fakeFetch([response(429, "too many", { "retry-after": "1" }), new TypeError("network"), response(200, apiBody([page()]))]);
  const out = await make(fn).search("q", opts());
  assert.equal(calls.length, 3);
  assert.equal(out.length, 1);
});

test("retries are bounded: persistent 429 → 1 + maxRetries attempts per wiki, at most 2 wikis (6 requests)", async () => {
  const { fn, calls } = fakeFetch([response(429, "too many")]);
  await assert.rejects(make(fn).search("q", opts()), (e: unknown) => e instanceof WikipediaHttpError && e.status === 429);
  assert.equal(calls.length, 6);
  const hosts = calls.map((c) => new URL(c.url).hostname);
  assert.equal(hosts.filter((h) => h === "en.wikipedia.org").length, 3);
  assert.equal(hosts.filter((h) => h === "fr.wikipedia.org").length, 3);
});

test("maxlag API response is retried", async () => {
  const { fn, calls } = fakeFetch([response(200, { error: { code: "maxlag" } }), response(200, apiBody([page()]))]);
  assert.equal((await make(fn).search("q", opts())).length, 1);
  assert.equal(calls.length, 2);
});

test("cache: the same query is served from memory (no second request) until TTL expires", async () => {
  let now = 0;
  const { fn, calls } = fakeFetch([response(200, apiBody([page()]))]);
  const r = make(fn, { now: () => now, cacheTtlMs: 1000 });
  await r.search("What is photosynthesis?", opts());
  await r.search("what is photosynthesis", opts());
  assert.equal(calls.length, 1, "normalized query hits the cache");
  now = 2000;
  await r.search("What is photosynthesis?", opts());
  assert.equal(calls.length, 2, "expired entry refetched");
});

test("throttle: requests are spaced by the minimum interval", async () => {
  const times: number[] = [];
  const { fn } = fakeFetch([
    async () => {
      times.push(Date.now());
      return response(200, apiBody([page()]));
    },
  ]);
  const r = make(fn, { minIntervalMs: 60 });
  await r.search("a", opts());
  await r.search("b", opts());
  assert.ok(times[1]! - times[0]! >= 50, `gap ${times[1]! - times[0]!}ms`);
});

test("abort signal cancels a pending backoff immediately (timeout respected)", async () => {
  const ctrl = new AbortController();
  const { fn } = fakeFetch([response(503, "busy", { "retry-after": "60" })]);
  const r = make(fn, { maxRetryAfterMs: 60_000 });
  const p = r.search("q", opts(ctrl.signal));
  setTimeout(() => ctrl.abort(), 20);
  const started = Date.now();
  await assert.rejects(p, (e: any) => e.name === "AbortError");
  assert.ok(Date.now() - started < 1000);
});

// ---------------------------------------------------------------- integration with services (fake fetch)

test("integration: Knowledge Explorer (live, fake client) cites a Wikipedia source → source_backed + wikipedia_only notice", async () => {
  const answer = sampleKnowledgeAnswer();
  answer.segments[0]!.sourceIds = ["S1"];
  const { client } = fakeClient([okResponse(answer, "claude-sonnet-5-5")]);
  const { AnthropicKnowledgeProvider } = await import("../../src/knowledge/anthropic-provider.ts");
  const retriever = make(fakeFetch([response(200, apiBody([page()]))]).fn);
  const res = await new KnowledgeService({ provider: new AnthropicKnowledgeProvider({ client, models: { learn: "a", fast: "b" } }), retriever }).query({
    question: "What is photosynthesis?",
    level: "intermediate",
    language: "en",
  });
  assert.equal(res.verification.status, "source_backed");
  assert.equal(res.sources[0]!.retriever, "wikipedia");
  assert.ok(res.notices.includes("wikipedia_only"), "Wikipedia is never presented as sufficient on its own");
});

test("integration: Evidence Analyzer quote from Wikipedia → verdict + wikipedia_only notice", async () => {
  const analysis = {
    understood: { claimRestated: "Plants convert light into chemical energy.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [{ id: "c1", text: "Plants convert light into chemical energy.", type: "factual", evidence: [{ sourceId: "S1", stance: "supports", quote: "convert light energy into chemical energy" }], missingEvidence: "A biology textbook.", backgroundNote: null }],
    caveats: [],
  };
  const { client } = fakeClient([okResponse(analysis, "claude-opus-5-5")]);
  const retriever = make(fakeFetch([response(200, apiBody([page()]))]).fn);
  const r = await new EvidenceService({ provider: new AnthropicEvidenceProvider({ client, model: "claude-opus-5-5" }), retriever }).analyze({ claim: "Plants convert light into chemical energy", language: "en" });
  assert.equal(r.overall.verdict, "supported");
  assert.ok(r.notices.includes("wikipedia_only"));
});

test("integration: retrieval failure (Wikipedia down) degrades to no sources, never an error", async () => {
  const retriever = make(fakeFetch([response(503, "down")]).fn);
  const { client } = fakeClient([okResponse(sampleKnowledgeAnswer(), "claude-sonnet-5-5")]);
  const { AnthropicKnowledgeProvider } = await import("../../src/knowledge/anthropic-provider.ts");
  const res = await new KnowledgeService({ provider: new AnthropicKnowledgeProvider({ client, models: { learn: "a", fast: "b" } }), retriever }).query({ question: "q??", level: "intermediate", language: "en" });
  assert.equal(res.verification.status, "not_source_verified");
  assert.equal(res.verification.retrievalNote, "failed");
});

test("factory: wikipedia by default, none when disabled; custom User-Agent from config", () => {
  assert.equal(createRetriever(loadConfig({})).name, "wikipedia");
  assert.equal(createRetriever(loadConfig({ SCIORA_RETRIEVER: "none" })).enabled, false);
  assert.match(loadConfig({}).wikiUserAgent, /SCIORA/);
  assert.equal(loadConfig({ SCIORA_WIKI_USER_AGENT: "MyApp/1 (https://example.org/contact)" }).wikiUserAgent, "MyApp/1 (https://example.org/contact)");
  assert.throws(() => loadConfig({ SCIORA_RETRIEVER: "google" }));
});

test("a failing first wiki (e.g. 429 on ar) falls back to the next wiki", async () => {
  const { fn, calls } = fakeFetch([
    response(429, "too many"), response(429, "too many"), response(429, "too many"), // ar: 1 + 2 retries
    response(200, apiBody([page()])), // en
  ]);
  const out = await make(fn).search("شنو هو التركيب الضوئي؟", { ...opts(), language: "darija" });
  assert.equal(new URL(calls[0]!.url).hostname, "ar.wikipedia.org");
  assert.equal(new URL(calls[3]!.url).hostname, "en.wikipedia.org");
  assert.equal(out.length, 1);
});

test("all wikis failing → error is raised (service reports retrieval 'failed')", async () => {
  const { fn } = fakeFetch([response(503, "down")]);
  await assert.rejects(make(fn).search("q", opts()), (e: unknown) => e instanceof WikipediaHttpError && e.status === 503);
});
