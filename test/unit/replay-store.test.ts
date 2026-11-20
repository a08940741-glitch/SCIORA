import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplayStore, createAnswerHasher } from "../../src/domain/replay-store.ts";
import type { GradeResult } from "../../src/domain/schemas.ts";

const T0 = 1_800_000_000_000;
function clock(start = T0) {
  const c = { ms: start, now: () => c.ms };
  return c;
}
const sec = (ms: number) => Math.floor(ms / 1000);

function result(id: string, verdict: GradeResult["verdict"] = "incorrect"): GradeResult {
  return {
    exerciseId: id,
    verdict,
    score: verdict === "correct" ? 1 : 0,
    method: "deterministic",
    feedback: "f",
    criteria: [],
    misconception: null,
    uncertaintyReason: null,
    correctAnswer: "a",
    explanation: "e",
    gradedBy: { source: "rules", simulated: false, model: null },
    countsTowardEstimate: true,
  };
}

test("reserve → complete → repeat returns the ORIGINAL result, never a new grading", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 10, highWater: 0.9, now: c.now });
  const exp = sec(T0) + 7200;
  assert.deepEqual(s.reserve("t1", "q1", "hashA", exp), { kind: "reserved" });
  s.complete("t1", "q1", result("q1", "incorrect"));
  const again = s.reserve("t1", "q1", "hashB-different-answer", exp);
  assert.equal(again.kind, "already_graded");
  if (again.kind === "already_graded") assert.equal(again.result.verdict, "incorrect");
});

test("PENDING record answers in_progress with retryAfter 2", () => {
  const s = new ReplayStore({ maxEntries: 10, highWater: 0.9, now: clock().now });
  const exp = sec(T0) + 7200;
  s.reserve("t1", "q1", "h", exp);
  assert.deepEqual(s.reserve("t1", "q1", "h", exp), { kind: "in_progress", retryAfterSec: 2 });
});

test("failed-grade-same-answer-retry-ok / different-answer-locked", () => {
  const s = new ReplayStore({ maxEntries: 10, highWater: 0.9, now: clock().now });
  const exp = sec(T0) + 7200;
  s.reserve("t1", "q1", "hashA", exp);
  s.fail("t1", "q1");
  assert.equal(s.peekState("t1", "q1"), "failed_retryable");
  assert.deepEqual(s.reserve("t1", "q1", "hashB", exp), { kind: "answer_locked" });
  assert.deepEqual(s.reserve("t1", "q1", "hashA", exp), { kind: "reserved" });
  assert.equal(s.peekState("t1", "q1"), "pending");
});

test("stale-pending-recovers: PENDING past timeout becomes FAILED_RETRYABLE, answer stays locked", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 10, highWater: 0.9, pendingTimeoutMs: 150_000, now: c.now });
  const exp = sec(T0) + 7200;
  s.reserve("t1", "q1", "hashA", exp);
  c.ms += 149_000;
  assert.equal(s.reserve("t1", "q1", "hashA", exp).kind, "in_progress");
  c.ms += 2_000;
  assert.deepEqual(s.reserve("t1", "q1", "hashB", exp), { kind: "answer_locked" });
  assert.equal(s.peekState("t1", "q1"), "failed_retryable");
  assert.deepEqual(s.reserve("t1", "q1", "hashA", exp), { kind: "reserved" });
});

test("capacity-never-evicts-unexpired: full store refuses, every existing record survives", () => {
  const s = new ReplayStore({ maxEntries: 5, highWater: 1, now: clock().now });
  const exp = sec(T0) + 7200;
  for (let i = 0; i < 5; i++) {
    s.reserve(`t${i}`, "q1", "h", exp);
    s.complete(`t${i}`, "q1", result("q1"));
  }
  const out = s.reserve("tNew", "q1", "h", exp);
  assert.equal(out.kind, "capacity");
  assert.equal(s.size, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(s.peekState(`t${i}`, "q1"), "done", `record t${i} must survive`);
    assert.equal(s.reserve(`t${i}`, "q1", "other", exp).kind, "already_graded", "replay protection intact");
  }
});

test("capacity-retry-after-header: retryAfter equals time until the oldest record may be removed", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 2, highWater: 1, now: c.now });
  const now = sec(T0);
  s.reserve("a", "q", "h", now + 300); // earliest
  s.reserve("b", "q", "h", now + 900);
  const out = s.reserve("c", "q", "h", now + 7200);
  assert.equal(out.kind, "capacity");
  if (out.kind === "capacity") assert.equal(out.retryAfterSec, 300 + 60 + 1);
});

test("capacity-cleans-expired-first: expired records are removed, then reservation succeeds", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 3, highWater: 1, now: c.now });
  const now = sec(T0);
  s.reserve("old1", "q", "h", now + 10);
  s.reserve("old2", "q", "h", now + 10);
  s.reserve("live", "q", "h", now + 7200);
  c.ms += (10 + 61) * 1000; // old1/old2 past exp + skew
  assert.deepEqual(s.reserve("new", "q", "h", sec(c.ms) + 7200), { kind: "reserved" });
  assert.equal(s.peekState("old1", "q"), undefined);
  assert.equal(s.peekState("live", "q"), "pending", "unexpired record kept");
});

test("records inside the clock-skew window are NOT considered expired", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 1, highWater: 1, now: c.now });
  const now = sec(T0);
  s.reserve("a", "q", "h", now + 10);
  c.ms += (10 + 60) * 1000; // exactly exp + skew: still protected
  assert.equal(s.reserve("b", "q", "h", now + 7200).kind, "capacity");
});

test("capacity-blocks-learn-at-high-water: new sets refused at 90%, allowed after expiry", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 10, highWater: 0.9, now: c.now });
  const now = sec(T0);
  for (let i = 0; i < 8; i++) s.reserve(`t${i}`, "q", "h", now + 100);
  assert.deepEqual(s.canIssueNewSet(), { ok: true });
  s.reserve("t8", "q", "h", now + 100); // 9/10 = 90%
  const blocked = s.canIssueNewSet();
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.retryAfterSec >= 1);
  c.ms += (100 + 61) * 1000;
  assert.deepEqual(s.canIssueNewSet(), { ok: true });
});

test("concurrent-20-requests-one-grade (store level): only one of 20 interleaved reserves wins", async () => {
  const s = new ReplayStore({ maxEntries: 100, highWater: 0.9, now: clock().now });
  const exp = sec(T0) + 7200;
  const outcomes = await Promise.all(
    Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => s.reserve("t", "q", `hash${i}`, exp))),
  );
  assert.equal(outcomes.filter((o) => o.kind === "reserved").length, 1);
  assert.equal(outcomes.filter((o) => o.kind === "in_progress").length, 19);
});

test("sweep removes only expired records", () => {
  const c = clock();
  const s = new ReplayStore({ maxEntries: 10, highWater: 1, now: c.now });
  const now = sec(T0);
  s.reserve("e", "q", "h", now + 5);
  s.reserve("k", "q", "h", now + 5000);
  c.ms += 100_000;
  assert.equal(s.sweep(), 1);
  assert.equal(s.size, 1);
  assert.equal(s.peekState("k", "q"), "pending");
});

test("answer hasher: deterministic, keyed, and does not contain the answer", () => {
  const h1 = createAnswerHasher(Buffer.alloc(32, 1));
  const h2 = createAnswerHasher(Buffer.alloc(32, 2));
  assert.equal(h1("0.5"), h1("0.5"));
  assert.notEqual(h1("0.5"), h1("0.6"));
  assert.notEqual(h1("0.5"), h2("0.5"), "different secret → different hash");
  assert.match(h1("الضو"), /^[0-9a-f]{64}$/);
});
