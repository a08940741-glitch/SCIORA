import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { z } from "zod";
import { GroqClient, MAX_GROQ_ATTEMPTS, MAX_GROQ_RESPONSE_BYTES, callGroqStructured, parseRetryAfter } from "../../src/ai/groq-client.ts";
import { GROQ_ALLOWED_KEYWORDS, GroqSchemaError, assertGroqStrictSchema, toGroqStrictSchema } from "../../src/ai/groq-schema.ts";
import { GroqProvider, GROQ_MAX_TOKENS } from "../../src/ai/groq-provider.ts";
import { GroqKnowledgeProvider } from "../../src/knowledge/groq-provider.ts";
import { GroqEvidenceProvider } from "../../src/evidence/groq-provider.ts";
import { EvidenceService } from "../../src/evidence/service.ts";
import { ProviderError } from "../../src/ai/provider.ts";
import { LESSON_SYSTEM_PROMPT, JUDGE_SYSTEM_PROMPT } from "../../src/ai/prompts.ts";
import { GeneratedLesson, WrittenJudgement, type ShortTextExercise } from "../../src/domain/schemas.ts";
import { ExamplesOutput, GeneratedKnowledgeAnswer, QuizOutput, SimplifyOutput } from "../../src/knowledge/schemas.ts";
import { GeneratedClaimAnalysis } from "../../src/evidence/schemas.ts";
import { FAKE_GROQ_KEY, fakeGroqClient, fakeGroqFetch, groqOk, groqRaw, hangingStep } from "../helpers/fake-groq.ts";
import { sampleLesson } from "../helpers/sample-lesson.ts";
import { sampleKnowledgeAnswer, fakeSource } from "../helpers/knowledge.ts";
import { allMet } from "../helpers/app.ts";

const MODEL = "openai/gpt-oss-120b";
const MODELS = { learn: MODEL, fast: "openai/gpt-oss-20b" };
const SCHEMAS = { GeneratedLesson, WrittenJudgement, GeneratedKnowledgeAnswer, SimplifyOutput, ExamplesOutput, QuizOutput, GeneratedClaimAnalysis };

function call(client: GroqClient, schema: z.ZodType = WrittenJudgement, timeoutMs = 5_000) {
  return callGroqStructured(client, timeoutMs, { model: MODEL, effort: "low", system: "SYS", user: "USER", schemaName: "t", schema, maxTokens: 100 });
}
function walk(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (node.properties) Object.values(node.properties).forEach((c) => walk(c, visit));
  if (node.items) walk(node.items, visit);
  if (node.anyOf) node.anyOf.forEach((b: any) => walk(b, visit));
}
function analysis(quote: string): GeneratedClaimAnalysis {
  return {
    understood: { claimRestated: "The Sun orbits the Earth.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [{ id: "c1", text: "The Sun orbits the Earth.", type: "factual", evidence: [{ sourceId: "S1", stance: "contradicts", quote }], missingEvidence: "An astronomy textbook.", backgroundNote: null }],
    caveats: [],
  };
}

// ================================================================= schema conversion

test("schema: every SCIORA AI output schema converts to Groq strict form (allowed keywords only)", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const js = toGroqStrictSchema(schema);
    assert.doesNotThrow(() => assertGroqStrictSchema(js), name);
    walk(js, (n) => {
      for (const k of Object.keys(n)) assert.ok(GROQ_ALLOWED_KEYWORDS.has(k), `${name}: keyword ${k}`);
      if (n.type === "object") {
        assert.equal(n.additionalProperties, false, `${name}: additionalProperties`);
        assert.deepEqual([...n.required].sort(), Object.keys(n.properties).sort(), `${name}: all properties required`);
      }
    });
  }
});

test("schema: the exercise discriminated union becomes anyOf with an enum discriminator per branch", () => {
  const items = (toGroqStrictSchema(GeneratedLesson) as any).properties.exercises.items;
  assert.ok(Array.isArray(items.anyOf));
  assert.equal(items.oneOf, undefined);
  assert.deepEqual(items.anyOf.map((b: any) => b.properties.type.enum), [["mcq"], ["numeric"], ["expression"], ["short_text"]]);
});

test("schema: length/pattern constraints are moved to descriptions as hints (enforced locally by zod)", () => {
  const js: any = toGroqStrictSchema(GeneratedLesson);
  assert.match(js.properties.understood.properties.topic.description, /maxLength: 120/);
  assert.equal(js.properties.understood.properties.topic.maxLength, undefined);
});

test("schema: unsupported shapes are refused (optional fields, records) instead of silently changed", () => {
  assert.throws(() => toGroqStrictSchema(z.object({ a: z.string(), b: z.string().optional() })), GroqSchemaError);
  assert.throws(() => toGroqStrictSchema(z.object({ m: z.record(z.string(), z.string()) })), GroqSchemaError);
  assert.throws(() => assertGroqStrictSchema({ type: "string", pattern: "x" }), GroqSchemaError);
});

test("validation is NOT weakened: a response breaking a zod-only constraint is rejected after one retry", async () => {
  const bad = { ...sampleLesson(), understood: { ...sampleLesson().understood, topic: "x".repeat(500) } };
  const { client, calls } = fakeGroqClient([groqOk(bad), groqOk(bad)]);
  await assert.rejects(call(client, GeneratedLesson), (e: unknown) => e instanceof ProviderError && e.code === "bad_output");
  assert.equal(calls.length, 2);
});

// ================================================================= request shape

test("request: OpenAI-compatible endpoint, bearer key, strict json_schema, reasoning effort, no Anthropic params", async () => {
  const { client, calls } = fakeGroqClient([groqOk(sampleLesson())]);
  const p = new GroqProvider({ client, models: MODELS });
  const out = await p.generateLesson({ question: "Explain photosynthesis", level: "school", language: "en" });
  assert.equal(out.meta.source, "groq");
  assert.equal(out.meta.simulated, false);
  assert.equal(out.meta.model, MODEL);
  assert.equal(calls.length, 1);
  const c = calls[0]!;
  assert.equal(c.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(c.headers.authorization, `Bearer ${FAKE_GROQ_KEY}`);
  assert.equal(c.body.model, MODEL);
  assert.equal(c.body.messages[0].role, "system");
  assert.equal(c.body.messages[0].content, LESSON_SYSTEM_PROMPT);
  assert.match(c.body.messages[1].content, /<student_question>\nExplain photosynthesis\n<\/student_question>/);
  assert.equal(c.body.response_format.type, "json_schema");
  assert.equal(c.body.response_format.json_schema.strict, true);
  assert.equal(c.body.response_format.json_schema.name, "sciora_lesson");
  assert.equal(c.body.reasoning_effort, "medium");
  assert.equal(c.body.include_reasoning, false);
  assert.equal(c.body.max_completion_tokens, GROQ_MAX_TOKENS.lesson);
  assert.equal(c.body.stream, false);
  for (const k of ["betas", "fallbacks", "output_config", "max_tokens"]) assert.equal(c.body[k], undefined, k);
  assert.ok(c.signal, "every request carries a timeout signal");
});

test("request: reasoning_effort is sent only to gpt-oss models (others could reject it)", async () => {
  const { client, calls } = fakeGroqClient([groqOk(allMet())]);
  await callGroqStructured(client, 5_000, { model: "qwen/qwen3.8-27b", effort: "low", system: "S", user: "U", schemaName: "j", schema: WrittenJudgement, maxTokens: 50 });
  assert.equal(calls[0]!.body.reasoning_effort, undefined);
  assert.equal(calls[0]!.body.include_reasoning, undefined);
});

// ================================================================= the four feature paths

test("feature: written grading uses the FAST model at low effort; escalation tier uses the LEARN model", async () => {
  const ex = sampleLesson().exercises.find((e) => e.type === "short_text") as ShortTextExercise;
  const input = { exercise: ex, answer: "student text", language: "en" as const, subject: "life_earth_sciences" as const, level: "school" as const };
  const { client, calls } = fakeGroqClient([groqOk(allMet(), MODELS.fast), groqOk(allMet(), MODELS.learn)]);
  const p = new GroqProvider({ client, models: MODELS });
  const fast = await p.judgeWritten(input, "fast");
  assert.deepEqual([fast.source, fast.model, fast.method, fast.simulated], ["groq", MODELS.fast, "rubric_ai", false]);
  assert.equal(calls[0]!.body.model, MODELS.fast);
  assert.equal(calls[0]!.body.reasoning_effort, "low");
  assert.equal(calls[0]!.body.messages[0].content, JUDGE_SYSTEM_PROMPT);
  await p.judgeWritten(input, "learn");
  assert.equal(calls[1]!.body.model, MODELS.learn);
  assert.equal(calls[1]!.body.reasoning_effort, "medium");
});

test("feature: knowledge answer (LEARN) and simplify / examples / quiz transforms (FAST)", async () => {
  const simplify = { title: "Simple", text: "Plants make food from light.", caveats: [] };
  const examples = { title: "Examples", examples: [{ title: "A", body: "B" }, { title: "C", body: "D" }], caveats: [] };
  const quiz = {
    title: "Quiz",
    questions: [1, 2, 3].map((n) => ({ question: `Q${n}?`, choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }, { id: "c", text: "z" }], correctChoiceId: "a", explanation: "Because." })),
    caveats: [],
  };
  const { client, calls } = fakeGroqClient([groqOk(sampleKnowledgeAnswer()), groqOk(simplify, MODELS.fast), groqOk(examples, MODELS.fast), groqOk(quiz, MODELS.fast)]);
  const p = new GroqKnowledgeProvider({ client, models: MODELS });
  const a = await p.answer({ request: { question: "What is photosynthesis?", level: "intermediate", language: "en" }, sources: [] });
  assert.equal(a.meta.source, "groq");
  assert.equal(calls[0]!.body.model, MODEL);
  assert.match(calls[0]!.body.messages[1].content, /NO SOURCES WERE RETRIEVED/);
  const content = { topic: "Photosynthesis", summary: "Plants make food.", points: [] };
  for (const mode of ["simplify", "examples", "quiz"] as const) {
    const t = await p.transform({ mode, level: "intermediate", language: "en", content });
    assert.equal(t.output.mode, mode);
    assert.equal(t.meta.source, "groq");
  }
  assert.deepEqual(calls.slice(1).map((c) => [c.body.model, c.body.response_format.json_schema.name, c.body.reasoning_effort]), [
    [MODELS.fast, "sciora_simplify", "low"],
    [MODELS.fast, "sciora_examples", "low"],
    [MODELS.fast, "sciora_quiz", "low"],
  ]);
});

test("feature: evidence uses the REASON model; the server still removes a quote not found in the sources", async () => {
  const { client, calls } = fakeGroqClient([groqOk(analysis("The Sun orbits the Earth daily (invented)"))]);
  const provider = new GroqEvidenceProvider({ client, model: MODEL });
  const retriever = { name: "fake", enabled: true, retrieve: async () => [fakeSource({ excerpt: "The Earth orbits the Sun once every 365.25 days approximately." })] };
  const r = await new EvidenceService({ provider, retriever: retriever as any }).analyze({ claim: "The Sun orbits the Earth", language: "en" });
  assert.equal(calls[0]!.body.model, MODEL);
  assert.equal(calls[0]!.body.response_format.json_schema.name, "sciora_claim_analysis");
  assert.equal(r.meta.source, "groq");
  assert.equal(r.subClaims[0]!.evidence.length, 0, "invented quote removed by the server");
  assert.equal(r.subClaims[0]!.verdict, "insufficient_evidence");
});

// ================================================================= errors, retries, timeouts

test("429: rate_limited with Retry-After seconds, and NOT retried (one request only)", async () => {
  const { client, calls } = fakeGroqClient([{ status: 429, body: { error: { message: "rate limit" } }, headers: { "retry-after": "12" } }, groqOk(allMet())]);
  await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "rate_limited" && e.retryAfterSec === 12 && e.httpStatus === 429);
  assert.equal(calls.length, 1);
});

test("Retry-After parsing: seconds, HTTP date, missing/invalid → 30 s, capped at 1 hour", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.equal(parseRetryAfter("7", now), 7);
  assert.equal(parseRetryAfter("2.2", now), 3);
  assert.equal(parseRetryAfter("Sat, 21 Nov 2026 12:00:45 GMT", now), 45);
  assert.equal(parseRetryAfter(null, now), 30);
  assert.equal(parseRetryAfter("soon", now), 30);
  assert.equal(parseRetryAfter("999999", now), 3600);
});

test("HTTP errors map to SCIORA errors with one request each (auth, model, size, server, capacity)", async () => {
  const cases: [number, string][] = [
    [401, "misconfigured"], [403, "misconfigured"], [404, "misconfigured"], [400, "bad_output"],
    [413, "bad_output"], [422, "bad_output"], [498, "unavailable"], [500, "unavailable"], [503, "unavailable"],
  ];
  for (const [status, code] of cases) {
    const { client, calls } = fakeGroqClient([{ status, body: { error: { message: "x" } } }, groqOk(allMet())]);
    await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === code, `HTTP ${status}`);
    assert.equal(calls.length, 1, `HTTP ${status} not retried`);
  }
});

test("network failure → unavailable, not retried, original error text not exposed", async () => {
  const { client, calls } = fakeGroqClient([new TypeError("connect ECONNREFUSED 10.0.0.1:443 secret-detail")]);
  await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "unavailable" && !e.message.includes("secret-detail"));
  assert.equal(calls.length, 1);
});

test("timeout: a hanging request is aborted → unavailable ('did not respond in time'), not retried", async () => {
  const { client, calls } = fakeGroqClient([hangingStep()]);
  const started = Date.now();
  await assert.rejects(call(client, WrittenJudgement, 30), (e: unknown) => e instanceof ProviderError && e.code === "unavailable" && /in time/.test(e.message));
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - started < 5_000);
});

test("truncation (finish_reason=length): bad_output immediately, NOT retried (identical request would be cut off again)", async () => {
  const { client, calls } = fakeGroqClient([groqRaw('{"criteria":', "length"), groqOk(allMet())]);
  await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "bad_output" && /cut off/.test(e.message));
  assert.equal(calls.length, 1, "no second request after a cut-off");
  // Even a complete-looking JSON body is rejected when the model reports it was cut off.
  const looksComplete = fakeGroqClient([groqOk(allMet(), MODEL, "length")]);
  await assert.rejects(call(looksComplete.client), (e: unknown) => e instanceof ProviderError && e.code === "bad_output");
  assert.equal(looksComplete.calls.length, 1);
});

test("retry budget: malformed output then cut-off → stops after 2 requests total (never more)", async () => {
  const { client, calls } = fakeGroqClient([groqRaw("{bad"), groqRaw('{"x":', "length"), groqOk(allMet())]);
  await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "bad_output");
  assert.equal(calls.length, MAX_GROQ_ATTEMPTS);
});

test("response size: Content-Length above the cap → bad_output without reading the body", async () => {
  // (A ReadableStream pre-pulls on creation, so "cancelled" is the reliable signal that the
  // client abandoned the body instead of reading it.)
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const { fetchFn, calls } = fakeGroqFetch([async () => new Response(stream, { status: 200, headers: { "content-length": "5000000" } })]);
  const client = new GroqClient({ apiKey: FAKE_GROQ_KEY, fetch: fetchFn, maxResponseBytes: 1024 });
  await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "bad_output" && /too large/.test(e.message));
  assert.equal(calls.length, 1, "oversize is not retried");
  assert.equal(cancelled, true, "body stream cancelled, not read");
});

test("response size: streamed body without Content-Length is cut at the cap and the stream cancelled", async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      pulls++;
      ctrl.enqueue(new Uint8Array(512).fill(0x20)); // endless whitespace
    },
    cancel() {
      cancelled = true;
    },
  });
  const { fetchFn } = fakeGroqFetch([async () => new Response(stream, { status: 200 })]);
  const client = new GroqClient({ apiKey: FAKE_GROQ_KEY, fetch: fetchFn, maxResponseBytes: 2048 });
  await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "bad_output" && /too large/.test(e.message));
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6, `stopped reading near the cap (pulls: ${pulls})`);
});

test("response size: the default cap is 1 MiB and normal responses are accepted", async () => {
  assert.equal(MAX_GROQ_RESPONSE_BYTES, 1024 * 1024);
  const { client } = fakeGroqClient([groqOk(sampleLesson())]);
  assert.ok((await call(client, GeneratedLesson)).data);
});

test("timeout while reading the BODY (headers arrived, body never finishes) → unavailable, not retried", async () => {
  // A stream that never ends and ignores aborts: the client must still give up on time.
  const stream = new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.enqueue(new TextEncoder().encode('{"choices":')); } });
  const { fetchFn, calls } = fakeGroqFetch([async () => new Response(stream, { status: 200 })]);
  const client = new GroqClient({ apiKey: FAKE_GROQ_KEY, fetch: fetchFn });
  const started = Date.now();
  await assert.rejects(call(client, WrittenJudgement, 40), (e: unknown) => e instanceof ProviderError && e.code === "unavailable" && /in time/.test(e.message));
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - started < 5_000);
});

test("timer is cleared after success and after errors (no lingering timeout handles)", async () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const ok = fakeGroqClient([groqOk(allMet())]);
  await call(ok.client, WrittenJudgement, 60_000);
  const err = fakeGroqClient([{ status: 500, body: {} }]);
  await call(err.client, WrittenJudgement, 60_000).catch(() => {});
  const after = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.equal(after, before);
});

test("malformed output (invalid JSON, non-JSON body, wrong shape, missing choices) → retry once, then bad_output", async () => {
  const variants = [groqRaw("not json at all"), { status: 200, rawBody: "<html>oops</html>" }, groqRaw(JSON.stringify({ unexpected: true })), { status: 200, body: { model: MODEL } }];
  for (const v of variants) {
    const { client, calls } = fakeGroqClient([v, v, groqOk(allMet())]);
    await assert.rejects(call(client), (e: unknown) => e instanceof ProviderError && e.code === "bad_output");
    assert.equal(calls.length, 2, "bounded retry");
  }
  const recover = fakeGroqClient([groqRaw("{bad"), groqOk(allMet())]);
  assert.ok((await call(recover.client)).data);
});

test("refusal (message.refusal or content_filter) → refusal error, not retried", async () => {
  const a = fakeGroqClient([groqRaw(null, "stop", { refusal: "I can't help with that." }), groqOk(allMet())]);
  await assert.rejects(call(a.client), (e: unknown) => e instanceof ProviderError && e.code === "refusal");
  assert.equal(a.calls.length, 1);
  const b = fakeGroqClient([groqRaw("", "content_filter"), groqOk(allMet())]);
  await assert.rejects(call(b.client), (e: unknown) => e instanceof ProviderError && e.code === "refusal");
  assert.equal(b.calls.length, 1);
});

// ================================================================= key safety

test("key never appears in errors, JSON serialization or inspection of the client", async () => {
  const { client } = fakeGroqClient([{ status: 401, body: { error: { message: `bad key ${FAKE_GROQ_KEY}` } } }]);
  assert.equal(JSON.stringify(client).includes(FAKE_GROQ_KEY), false);
  assert.equal(inspect(client, { depth: 5, showHidden: true }).includes(FAKE_GROQ_KEY), false);
  const err = await call(client).catch((e) => e);
  assert.ok(err instanceof ProviderError);
  assert.equal(err.message.includes(FAKE_GROQ_KEY), false);
  assert.equal(JSON.stringify(err).includes(FAKE_GROQ_KEY), false);
  assert.equal(inspect(err, { depth: 5 }).includes(FAKE_GROQ_KEY), false);
});

test("provider error bodies (which may echo student text) are never copied into SCIORA errors", async () => {
  const echoed = "my secret student answer";
  for (const status of [400, 413, 429, 500]) {
    const { client } = fakeGroqClient([{ status, body: { error: { message: `Invalid input: ${echoed}` } } }]);
    const err = await call(client).catch((e) => e);
    assert.equal(String(err.message).includes(echoed), false, `HTTP ${status}`);
  }
});

test("client refuses to be created without a key", () => {
  assert.throws(() => new GroqClient({ apiKey: "" }));
});

// ================================================================= single-character patterns → enum

test("schema: exact single-character patterns become enums; complex patterns stay description hints", async () => {
  const { patternToEnum } = await import("../../src/ai/groq-schema.ts");
  assert.deepEqual(patternToEnum("^[a-d]$"), ["a", "b", "c", "d"]);
  assert.deepEqual(patternToEnum("^c[1-6]$"), ["c1", "c2", "c3", "c4", "c5", "c6"]);
  assert.deepEqual(patternToEnum("^[abc]$"), ["a", "b", "c"]);
  for (const p of ["^S[1-9][0-9]?$", "^[a-z0-9_-]{1,32}$", "^[a-d]+$", "^(a|b)$", "^[a-]$", "^[z-a]$", "^[a-9]$", "[a-d]", "^[\\w]$"]) {
    assert.equal(patternToEnum(p), null, p);
  }
  const quiz: any = toGroqStrictSchema(QuizOutput);
  const q = quiz.properties.questions.items.properties;
  assert.deepEqual(q.choices.items.properties.id.enum, ["a", "b", "c", "d"]);
  assert.deepEqual(q.correctChoiceId.enum, ["a", "b", "c", "d"]);
  assert.equal(String(q.correctChoiceId.description ?? "").includes("pattern"), false, "pattern hint replaced by the enum");
  const claim: any = toGroqStrictSchema(GeneratedClaimAnalysis);
  assert.deepEqual(claim.properties.subClaims.items.properties.id.enum, ["c1", "c2", "c3", "c4", "c5", "c6"]);
  const lesson: any = toGroqStrictSchema(GeneratedLesson);
  assert.match(lesson.properties.exercises.items.anyOf[0].properties.id.description, /pattern: \^\[a-z0-9_-\]\{1,32\}\$/);
});

test("schema: the converted enum is never looser than zod (zod still rejects what the enum excludes)", async () => {
  const quiz = {
    title: "Quiz",
    questions: [1, 2, 3].map((n) => ({ question: `Q${n}?`, choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }, { id: "E", text: "z" }], correctChoiceId: "a", explanation: "Because." })),
    caveats: [],
  };
  const { client, calls } = fakeGroqClient([groqOk(quiz), groqOk(quiz)]);
  await assert.rejects(call(client, QuizOutput), (e: unknown) => e instanceof ProviderError && e.code === "bad_output");
  assert.equal(calls.length, 2);
});
