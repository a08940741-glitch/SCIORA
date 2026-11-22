import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/ai/provider.ts";
import { findForbiddenKeys, containsText } from "../helpers/leak.ts";
import { SECRET_MARKERS } from "../helpers/sample-lesson.ts";
import {
  STUDENT_ANSWER,
  StubLiveProvider,
  TEST_SECRET_B64,
  allMet,
  grade,
  learn,
  makeApp,
  unclear,
} from "../helpers/app.ts";

// ============================================================ health & transparency

test("health (demo): mode demo, simulated, no models, demo topics listed, nothing secret", async () => {
  const { app } = await makeApp({ env: { ANTHROPIC_API_KEY: "test-key-not-real" } });
  const res = await app.inject({ url: "/api/health" });
  const b = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(b.mode, "demo");
  assert.equal(b.simulated, true);
  assert.equal(b.models, null);
  assert.equal(b.demoTopics.length, 5);
  // Phase 2A: Knowledge Explorer is implemented, so it must no longer be listed as planned.
  assert.equal(b.plannedNotImplemented.includes("knowledge_explorer"), false);
  // Phase 2B: Evidence Analyzer implemented; real source retrieval is still not implemented.
  assert.equal(b.plannedNotImplemented.includes("evidence_analyzer"), false);
  assert.ok(b.plannedNotImplemented.includes("real_source_retrieval"));
  assert.equal(res.body.includes("test-key-not-real"), false);
  assert.equal(res.body.includes(TEST_SECRET_B64), false);
});

test("health (live stub): mode live with configured models", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const b = (await app.inject({ url: "/api/health" })).json();
  assert.equal(b.mode, "live");
  assert.equal(b.simulated, false);
  assert.deepEqual(b.models, { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" });
});

test("demo lesson via HTTP is labelled simulated with a DEMO caveat", async () => {
  const { app } = await makeApp();
  const { res, body } = await learn(app);
  assert.equal(res.statusCode, 200);
  assert.equal(body.meta.source, "demo");
  assert.equal(body.meta.simulated, true);
  assert.equal(body.meta.model, null);
  assert.ok(body.notices.includes("demo_content"));
  assert.ok(body.exerciseSet.token.startsWith("v1."));
});

test("live-failure-not-replaced-by-demo: provider error → error response, no lesson", async () => {
  const p = new StubLiveProvider(undefined, async () => {
    throw new ProviderError("unavailable", "The AI service could not be reached.");
  });
  const { app } = await makeApp({ provider: p });
  const { res, body } = await learn(app);
  assert.equal(res.statusCode, 503);
  assert.equal(body.error, "unavailable");
  assert.equal(body.lesson, undefined);
  assert.equal(containsText(body, "DEMO"), false);
});

test("demo unknown topic → 404 not_in_demo", async () => {
  const { app } = await makeApp();
  const { res, body } = await learn(app, "Who won the World Cup?");
  assert.equal(res.statusCode, 404);
  assert.equal(body.error, "not_in_demo");
});

// ============================================================ answer keys never leak

test("answer-key-not-in-response: no forbidden keys, no sealed text, anywhere in /api/learn output", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { res, body } = await learn(app);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(findForbiddenKeys(body), []);
  const decodedToken = body.exerciseSet.token
    .split(".")
    .map((p: string) => Buffer.from(p, "base64url").toString("utf8"))
    .join("\n");
  for (const m of SECRET_MARKERS) {
    assert.equal(res.body.includes(m), false, `response leaks ${m}`);
    assert.equal(decodedToken.includes(m), false, `token leaks ${m}`);
  }
});

test("answer-key-not-in-response (demo content): demo answers/model answers absent from response", async () => {
  const { app } = await makeApp();
  const { res, body } = await learn(app);
  assert.deepEqual(findForbiddenKeys(body), []);
  assert.equal(res.body.includes("correctChoiceId"), false);
  assert.equal(res.body.includes("modelAnswer"), false);
});

// ============================================================ validation

test("input validation: bad bodies → 400 with field names only", async () => {
  const { app } = await makeApp();
  const cases: unknown[] = [{}, { question: "" }, { question: "ab" }, { question: "x".repeat(1001) }, { question: 5 }, { question: "valid q", hack: true }, { question: "valid q", level: "genius" }];
  for (const payload of cases) {
    const res = await app.inject({ method: "POST", url: "/api/learn", payload: payload as object });
    assert.equal(res.statusCode, 400, JSON.stringify(payload).slice(0, 40));
    assert.equal(res.json().error, "invalid_request");
  }
  const bad = await app.inject({ method: "POST", url: "/api/learn", headers: { "content-type": "application/json" }, payload: "{not json" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.includes("at "), false, "no stack trace");
});

test("body larger than 32 KB → 413", async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: "POST", url: "/api/learn", payload: { question: "x".repeat(40000) } });
  assert.equal(res.statusCode, 413);
});

test("unknown API endpoint → JSON 404", async () => {
  const { app } = await makeApp();
  const res = await app.inject({ url: "/api/nope" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "not_found");
});

// ============================================================ grading: deterministic types

test("mcq: correct answer graded, correct answer revealed after attempt", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  const { res, body } = await grade(app, l.exerciseSet.token, "q1", "a");
  assert.equal(res.statusCode, 200);
  assert.equal(body.result.verdict, "correct");
  assert.equal(body.result.method, "deterministic");
  assert.equal(body.result.gradedBy.source, "rules");
  assert.equal(body.result.replayed, false);
  assert.ok(body.result.correctAnswer.length > 0);
});

test("replay-returns-original: grade A (wrong) then B → 409 with ORIGINAL result; B never graded", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  const first = await grade(app, l.exerciseSet.token, "q1", "b");
  assert.equal(first.body.result.verdict, "incorrect");
  const second = await grade(app, l.exerciseSet.token, "q1", "a");
  assert.equal(second.res.statusCode, 409);
  assert.equal(second.body.error, "already_graded");
  assert.equal(second.body.result.verdict, "incorrect", "original result returned, new answer ignored");
  assert.equal(second.body.result.replayed, true);
});

test("invalid mcq choice → 400 and does NOT consume the attempt", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  assert.equal((await grade(app, l.exerciseSet.token, "q1", "z")).res.statusCode, 400);
  assert.equal((await grade(app, l.exerciseSet.token, "q1", "a")).body.result.verdict, "correct");
});

test("numeric: Eastern Arabic decimal accepted; unreadable → 422 without consuming the attempt", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  const unreadable = await grade(app, l.exerciseSet.token, "q2", "نص");
  assert.equal(unreadable.res.statusCode, 422);
  assert.equal(unreadable.body.error, "unreadable_answer");
  const ok = await grade(app, l.exerciseSet.token, "q2", "٠٫٥");
  assert.equal(ok.body.result.verdict, "correct");
});

test("expression: equivalent form 2(x+1) accepted for 2*x+2", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  assert.equal((await grade(app, l.exerciseSet.token, "q3", "2(x+1)")).body.result.verdict, "correct");
});

// ============================================================ token attacks via HTTP

test("forged / tampered / malformed tokens → 400 invalid_token; unknown exercise → 400", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  const parts = l.exerciseSet.token.split(".");
  const tampered = [...parts];
  tampered[3] = (tampered[3][0] === "A" ? "B" : "A") + tampered[3].slice(1);
  for (const t of [tampered.join("."), "v1.deadbeef.AAAA.BBBB.CCCC", "not-a-token-at-all"]) {
    const { res, body } = await grade(app, t, "q1", "a");
    assert.equal(res.statusCode, 400);
    assert.equal(body.error, "invalid_token");
  }
  const unk = await grade(app, l.exerciseSet.token, "q9", "a");
  assert.equal(unk.res.statusCode, 400);
  assert.equal(unk.body.error, "unknown_exercise");
});

test("expired token → 410 token_expired", async () => {
  let now = 1_800_000_000_000;
  const { app } = await makeApp({ provider: new StubLiveProvider(), now: () => now });
  const { body: l } = await learn(app);
  now += (7200 + 61) * 1000;
  const { res, body } = await grade(app, l.exerciseSet.token, "q1", "a");
  assert.equal(res.statusCode, 410);
  assert.equal(body.error, "token_expired");
});

// ============================================================ written answers

test("short_text correct via rubric AI (fast tier)", async () => {
  const p = new StubLiveProvider(async () => allMet());
  const { app } = await makeApp({ provider: p });
  const { body: l } = await learn(app);
  const { body } = await grade(app, l.exerciseSet.token, "q4", STUDENT_ANSWER);
  assert.equal(body.result.verdict, "correct");
  assert.equal(body.result.method, "rubric_ai");
  assert.equal(body.result.gradedBy.model, "claude-haiku-5-5");
  assert.equal(body.result.countsTowardEstimate, true);
  assert.equal(p.judgeCalls[0]!.tier, "fast");
});

test("short_text uncertain: explained, does not count toward estimate, escalation OFF → one call", async () => {
  const p = new StubLiveProvider(async () => unclear());
  const { app } = await makeApp({ provider: p });
  const { body: l } = await learn(app);
  const { body } = await grade(app, l.exerciseSet.token, "q4", STUDENT_ANSWER);
  assert.equal(body.result.verdict, "uncertain");
  assert.equal(body.result.score, null);
  assert.equal(body.result.countsTowardEstimate, false);
  assert.match(body.result.uncertaintyReason, /SCIORA could not determine/);
  assert.equal(p.judgeCalls.length, 1);
});

test("escalation ON: uncertain Haiku result is re-graded once by the LEARN model", async () => {
  const p = new StubLiveProvider(async (_i, tier) => (tier === "fast" ? unclear() : allMet()));
  const { app } = await makeApp({ provider: p, env: { SCIORA_GRADE_ESCALATION: "on" } });
  const { body: l } = await learn(app);
  const { body } = await grade(app, l.exerciseSet.token, "q4", STUDENT_ANSWER);
  assert.deepEqual(p.judgeCalls.map((c) => c.tier), ["fast", "learn"]);
  assert.equal(body.result.verdict, "correct");
  assert.equal(body.result.gradedBy.model, "claude-sonnet-5-5");
});

test("grading failure: 503, then different answer → 409 answer_locked, same answer → graded", async () => {
  let fail = true;
  const p = new StubLiveProvider(async () => {
    if (fail) throw new ProviderError("unavailable", "The AI service could not be reached.");
    return allMet();
  });
  const { app } = await makeApp({ provider: p });
  const { body: l } = await learn(app);
  const a = await grade(app, l.exerciseSet.token, "q4", STUDENT_ANSWER);
  assert.equal(a.res.statusCode, 503);
  assert.match(a.body.message, /NOT graded/);
  fail = false;
  const b = await grade(app, l.exerciseSet.token, "q4", "A different answer");
  assert.equal(b.res.statusCode, 409);
  assert.equal(b.body.error, "answer_locked");
  const c = await grade(app, l.exerciseSet.token, "q4", STUDENT_ANSWER);
  assert.equal(c.res.statusCode, 200);
  assert.equal(c.body.result.verdict, "correct");
});

// ============================================================ concurrency (HTTP)

test("concurrent-20-requests-one-grade: 20 simultaneous different answers → grader runs exactly once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const p = new StubLiveProvider(async () => {
    await gate;
    return allMet();
  });
  const { app } = await makeApp({ provider: p });
  const { body: l } = await learn(app);
  const token = l.exerciseSet.token;

  const pending = Array.from({ length: 20 }, (_, i) => grade(app, token, "q4", i === 0 ? STUDENT_ANSWER : `Answer number ${i}`));
  // Let all requests reach the server before the grader finishes.
  await new Promise((r) => setTimeout(r, 50));
  release();
  const results = await Promise.all(pending);

  assert.equal(p.judgeCalls.length, 1, "grader must run exactly once");
  const ok = results.filter((r) => r.res.statusCode === 200);
  const inProgress = results.filter((r) => r.res.statusCode === 409 && r.body.error === "grading_in_progress");
  assert.equal(ok.length, 1);
  assert.equal(inProgress.length, 19);
  assert.ok(inProgress.every((r) => r.res.headers["retry-after"] === "2"));

  // after-done-all-return-original
  const original = ok[0]!.body.result;
  for (let i = 0; i < 3; i++) {
    const again = await grade(app, token, "q4", `Another attempt ${i}`);
    assert.equal(again.res.statusCode, 409);
    assert.equal(again.body.error, "already_graded");
    assert.equal(again.body.result.verdict, original.verdict);
    assert.equal(again.body.result.feedback, original.feedback);
  }
});

test("mcq-also-reserved: 10 simultaneous MCQ submissions → exactly one graded", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  const results = await Promise.all(["a", "b", "c", "a", "b", "c", "a", "b", "c", "a"].map((x) => grade(app, l.exerciseSet.token, "q1", x)));
  assert.equal(results.filter((r) => r.res.statusCode === 200).length, 1);
  assert.equal(results.filter((r) => r.res.statusCode === 409).length, 9);
});

// ============================================================ capacity (fail closed)

test("capacity: full store → grading 503 'NOT graded' with Retry-After; existing records untouched", async () => {
  const { app, replay } = await makeApp({ provider: new StubLiveProvider(), env: { SCIORA_REPLAY_MAX_ENTRIES: "3", SCIORA_REPLAY_HIGH_WATER: "1" } });
  const { body: l1 } = await learn(app);
  await grade(app, l1.exerciseSet.token, "q1", "b");
  await grade(app, l1.exerciseSet.token, "q2", "0.5");
  await grade(app, l1.exerciseSet.token, "q3", "2x+2");
  assert.equal(replay.size, 3);
  const full = await grade(app, l1.exerciseSet.token, "q4", STUDENT_ANSWER);
  assert.equal(full.res.statusCode, 503);
  assert.equal(full.body.error, "capacity_exceeded");
  assert.match(full.body.message, /NOT graded/);
  assert.ok(Number(full.res.headers["retry-after"]) >= 1);
  const replayCheck = await grade(app, l1.exerciseSet.token, "q1", "a");
  assert.equal(replayCheck.body.error, "already_graded", "old record still protects against replay");
  assert.equal(replayCheck.body.result.verdict, "incorrect");
});

test("capacity-blocks-learn-at-high-water: /api/learn → 503 before calling the AI", async () => {
  const p = new StubLiveProvider();
  const { app, replay } = await makeApp({ provider: p, env: { SCIORA_REPLAY_MAX_ENTRIES: "10", SCIORA_REPLAY_HIGH_WATER: "0.9" } });
  const exp = Math.floor(Date.now() / 1000) + 7200;
  for (let i = 0; i < 9; i++) replay.reserve(`t${i}`, "q1", "h", exp);
  const { res, body } = await learn(app);
  assert.equal(res.statusCode, 503);
  assert.equal(body.error, "capacity_exceeded");
  assert.ok(res.headers["retry-after"]);
  assert.equal(p.lessonCalls, 0, "no AI cost when exercises cannot be issued");
});

// ============================================================ cost & abuse limits

test("daily limit (live only): second lesson refused with daily_limit", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider(), env: { SCIORA_DAILY_LIMIT: "1" } });
  assert.equal((await learn(app)).res.statusCode, 200);
  const second = await learn(app);
  assert.equal(second.res.statusCode, 503);
  assert.equal(second.body.error, "daily_limit");
});

test("daily limit does not apply to demo mode (no AI cost)", async () => {
  const { app } = await makeApp({ env: { SCIORA_DAILY_LIMIT: "1" } });
  assert.equal((await learn(app)).res.statusCode, 200);
  assert.equal((await learn(app)).res.statusCode, 200);
});

test("rate limit: requests beyond the per-minute limit → 429", async () => {
  const { app } = await makeApp({ env: { SCIORA_RATE_LIMIT_PER_MINUTE: "3" } });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await app.inject({ url: "/api/health" })).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

// ============================================================ headers, static files, logs

test("security headers: strict CSP, nosniff, no framing, no CORS", async () => {
  const { app } = await makeApp();
  const res = await app.inject({ url: "/api/health" });
  const csp = String(res.headers["content-security-policy"]);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("static: index served; server source and demo answer files are NOT served", async () => {
  const { app } = await makeApp();
  assert.equal((await app.inject({ url: "/" })).statusCode, 200);
  for (const url of ["/src/ai/demo-content/01-photosynthesis.json", "/../src/ai/demo-content/01-photosynthesis.json", "/%2e%2e/src/config.ts", "/.env", "/package.json"]) {
    const res = await app.inject({ url });
    assert.notEqual(res.statusCode, 200, url);
    assert.equal(res.body.includes("correctChoiceId"), false, url);
  }
});

test("no-secret-in-logs: tokens, answers, secrets and keys never appear in logs", async () => {
  const p = new StubLiveProvider(async () => {
    throw new ProviderError("unavailable", "down");
  });
  const { app, logs } = await makeApp({ provider: p, logLevel: "trace", env: { ANTHROPIC_API_KEY: "FAKE_KEY_SHOULD_NEVER_APPEAR_ZETA" } });
  const { body: l } = await learn(app);
  await grade(app, l.exerciseSet.token, "q4", "SECRET_ANSWER_TEXT_ZETA");
  await grade(app, "forged.token.value.here.x", "q1", "a");
  const all = logs.join("\n");
  assert.ok(all.length > 0, "logs were captured");
  assert.equal(all.includes(l.exerciseSet.token), false, "token in logs");
  assert.equal(all.includes(l.exerciseSet.token.split(".")[3]), false, "ciphertext in logs");
  assert.equal(all.includes("SECRET_ANSWER_TEXT_ZETA"), false, "answer in logs");
  assert.equal(all.includes(TEST_SECRET_B64), false, "secret in logs");
  assert.equal(all.includes("FAKE_KEY_SHOULD_NEVER_APPEAR_ZETA"), false, "api key in logs");
  for (const m of SECRET_MARKERS) assert.equal(all.includes(m), false, `marker ${m} in logs`);
});

test("lesson with broken generated exercises → exercises_removed notice (and the broken ones are not sealed)", async () => {
  const p = new StubLiveProvider();
  p.lessonImpl = async () => {
    const l = (await import("../helpers/sample-lesson.ts")).sampleLesson();
    (l.exercises[0] as any).correctChoiceId = "z";
    return { lesson: l, meta: { source: "anthropic", simulated: false, model: "claude-sonnet-5-5", fallbackUsed: false, generatedAt: "t" } };
  };
  const { app } = await makeApp({ provider: p });
  const { body } = await learn(app);
  assert.ok(body.notices.includes("exercises_removed"));
  assert.equal(body.lesson.exercises.some((e: any) => e.id === "q1"), false);
});

// ============================================================ English demo flow (default English experience)

test("english demo flow: /api/learn in English → English lesson; rule and written grading feedback in English", async () => {
  const ARABIC = /[؀-ۿ]/;
  const { app } = await makeApp();
  const res = await app.inject({ method: "POST", url: "/api/learn", payload: { question: "What is the Pythagorean theorem?", language: "en" } });
  const body = res.json() as any;
  assert.equal(res.statusCode, 200);
  assert.equal(body.lesson.understood.topic, "The Pythagorean theorem");
  assert.equal(body.notices.includes("demo_language_fixed"), false);
  assert.equal(ARABIC.test(JSON.stringify(body.lesson)), false, "public English lesson contains no Arabic script");
  const token = body.exerciseSet.token;

  const q1 = await grade(app, token, "q1", "b");
  assert.equal(q1.body.result.verdict, "correct");
  assert.equal(ARABIC.test(q1.body.result.feedback), false);

  const q2 = await grade(app, token, "q2", "13 cm");
  assert.equal(q2.body.result.verdict, "correct");

  const q3 = await grade(app, token, "q3", "In a right triangle the hypotenuse squared equals the sum of the squares of the other two sides.");
  assert.equal(q3.res.statusCode, 200);
  assert.equal(q3.body.result.verdict, "correct");
  assert.equal(ARABIC.test(q3.body.result.feedback), false);
});

test("health (demo): every demo topic and claim title is English (no bilingual fields)", async () => {
  const { app } = await makeApp();
  const b = (await app.inject({ url: "/api/health" })).json() as any;
  const titles = [...b.demoTopics.map((t: any) => t.topic), ...b.knowledge.demoTopics.map((t: any) => t.topic), ...b.evidence.demoClaims.map((c: any) => c.claim)];
  assert.equal(titles.length, 15);
  assert.ok(titles.every((t: string) => /^[\x20-\x7E]+$/.test(t)), titles.join(" | "));
  assert.ok([...b.demoTopics, ...b.knowledge.demoTopics].every((t: any) => !("topicEn" in t)));
});

// ============================================================ English-only policy (HTTP)

test("english-only: non-English questions/claims get 422 with the exact notice on every AI endpoint, before any AI call or budget use", async () => {
  const p = new StubLiveProvider();
  const { app } = await makeApp({ provider: p, env: { SCIORA_DAILY_LIMIT: "1" } });
  const NOTICE = "SCIORA currently supports English only. Please submit your question in English to continue.";
  const cases: [string, object][] = [
    ["/api/learn", { question: "شنو هو التركيب الضوئي؟" }],
    ["/api/learn", { question: "Qu'est-ce que la photosynthèse ?" }],
    ["/api/knowledge/query", { question: "chno howa tarkib daw2i" }],
    ["/api/knowledge/transform", { mode: "simplify", content: { topic: "التركيب الضوئي", summary: "النباتات كتصاوب الماكلة", points: [] } }],
    ["/api/evidence/analyze", { claim: "الما كيغلي ف 100 درجة فكل بلاصة" }],
  ];
  for (const [url, payload] of cases) {
    const r = await app.inject({ method: "POST", url, payload });
    assert.equal(r.statusCode, 422, url);
    assert.deepEqual(r.json(), { error: "english_only", message: NOTICE }, url);
  }
  // The daily cap (1) was not consumed by the rejected requests: an English lesson still works.
  const { res } = await learn(app, "What is photosynthesis?");
  assert.equal(res.statusCode, 200);
});

test("english-only: a non-English WRITTEN answer is not graded and does not consume the attempt; English then grades normally", async () => {
  const p = new StubLiveProvider(async () => allMet());
  const { app } = await makeApp({ provider: p });
  const { body: l } = await learn(app);
  const token = l.exerciseSet.token;
  const ar = await grade(app, token, "q4", "النبتة كتستعمل الضو ديال الشمس");
  assert.equal(ar.res.statusCode, 422);
  assert.equal(ar.body.error, "english_only");
  assert.equal(p.judgeCalls.length, 0, "no AI call for a rejected answer");
  const en = await grade(app, token, "q4", STUDENT_ANSWER);
  assert.equal(en.res.statusCode, 200, "attempt was not consumed by the rejected answer");
  assert.equal(en.body.result.verdict, "correct");
});

test("english-only: rule-graded answers are never language-checked (numbers, expressions, choices)", async () => {
  const { app } = await makeApp({ provider: new StubLiveProvider() });
  const { body: l } = await learn(app);
  const token = l.exerciseSet.token;
  assert.equal((await grade(app, token, "q1", "a")).body.result.verdict, "correct");
  assert.equal((await grade(app, token, "q2", "٠٫٥")).body.result.verdict, "correct", "digits in another script are still read as numbers");
  assert.equal((await grade(app, token, "q3", "2(x+1)")).body.result.verdict, "correct");
});

test("english-only: every demo AI response through HTTP is English (lesson, knowledge answer, transforms, evidence)", async () => {
  const { findNonEnglishOutput } = await import("../../src/domain/english-only.ts");
  const { app } = await makeApp();
  const post = async (url: string, payload: object) => (await app.inject({ method: "POST", url, payload })).json();
  for (const q of ["What is photosynthesis?", "Explain the Pythagorean theorem", "How do I expand 3(x+2)?", "What is inertia?", "What is the water cycle?"]) {
    const l = await post("/api/learn", { question: q });
    assert.equal(findNonEnglishOutput(l.lesson), null, q);
    const k = await post("/api/knowledge/query", { question: q });
    assert.equal(findNonEnglishOutput(k.answer), null, q);
    for (const mode of ["simplify", "examples", "quiz"]) {
      const t = await post("/api/knowledge/transform", { mode, content: { topic: k.answer.title, summary: k.answer.summary, points: [] } });
      assert.equal(findNonEnglishOutput(t.result), null, `${q} / ${mode}`);
    }
  }
  for (const claim of ["The Sun orbits the Earth", "Water boils at 100 degrees everywhere", "Mathematics is the hardest school subject", "It will rain tomorrow", "Pythagoras works for every triangle"]) {
    const e = await post("/api/evidence/analyze", { claim });
    assert.equal(findNonEnglishOutput({ understood: e.understood, subClaims: e.subClaims, caveats: e.caveats }), null, claim);
  }
});
