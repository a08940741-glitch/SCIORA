import { createHmac, hkdfSync } from "node:crypto";
import type { GradeResult } from "./schemas.ts";
import { CLOCK_SKEW_SECONDS } from "./exercise-token.ts";

/**
 * Replay store: guarantees each (tokenId, exerciseId) is graded at most once.
 *
 * Atomicity: `reserve()` is fully synchronous (no await between check and write).
 * Node runs JavaScript on one thread, so two simultaneous requests cannot both
 * pass the check. Grading (which may await the AI) starts only AFTER reservation.
 * LIMITATION: atomic within ONE Node process only. Multiple instances would need a
 * shared store with a unique constraint (e.g. SQLite/Redis).
 *
 * Capacity: an unexpired record is NEVER evicted. Only expired records are removed.
 * When full, the store fails closed (no grading without a record).
 * LIMITATION: in-memory; a server restart clears it. Tokens issued before the restart
 * could be re-graded until they expire (max SCIORA_TOKEN_TTL_SECONDS).
 *
 * States:  (absent) → PENDING → DONE{result}
 *                        └──────→ FAILED_RETRYABLE{answerHash}  (same answer may retry)
 */

export type ReplayState = "pending" | "done" | "failed_retryable";

interface Entry {
  state: ReplayState;
  answerHash: string;
  /** Token expiry, unix seconds. Record may be removed after exp + skew. */
  exp: number;
  reservedAtMs: number;
  result?: GradeResult;
}

export type ReserveOutcome =
  | { kind: "reserved" }
  | { kind: "in_progress"; retryAfterSec: number }
  | { kind: "already_graded"; result: GradeResult }
  | { kind: "answer_locked" }
  | { kind: "capacity"; retryAfterSec: number };

export type IssueOutcome = { ok: true } | { ok: false; retryAfterSec: number };

export interface ReplayStoreOptions {
  maxEntries: number;
  /** Fraction (0..1] at which new exercise sets are refused. */
  highWater: number;
  /** A PENDING record older than this becomes FAILED_RETRYABLE (answer stays locked). */
  pendingTimeoutMs?: number;
  now?: () => number; // ms
}

export class ReplayStore {
  private readonly map = new Map<string, Entry>();
  private readonly max: number;
  private readonly highWater: number;
  private readonly pendingTimeoutMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: ReplayStoreOptions) {
    if (opts.maxEntries < 1) throw new Error("maxEntries must be >= 1");
    this.max = opts.maxEntries;
    this.highWater = opts.highWater;
    this.pendingTimeoutMs = opts.pendingTimeoutMs ?? 150_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.map.size;
  }
  get capacity(): number {
    return this.max;
  }

  private static key(tid: string, exerciseId: string): string {
    return `${tid}:${exerciseId}`;
  }

  private nowSec(): number {
    return Math.floor(this.now() / 1000);
  }

  private isExpired(e: Entry): boolean {
    return this.nowSec() > e.exp + CLOCK_SKEW_SECONDS;
  }

  /** Removes ONLY expired records. Returns how many were removed. */
  sweep(): number {
    let removed = 0;
    for (const [k, e] of this.map) {
      if (this.isExpired(e)) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** Seconds until the earliest record expires (>= 1). */
  private retryAfter(): number {
    let earliest = Infinity;
    for (const e of this.map.values()) earliest = Math.min(earliest, e.exp + CLOCK_SKEW_SECONDS);
    if (!Number.isFinite(earliest)) return 1;
    return Math.max(1, earliest - this.nowSec() + 1);
  }

  /**
   * Atomically reserves a grading attempt. MUST stay synchronous.
   * @param exp token expiry (unix seconds), used to know when the record may be removed.
   */
  reserve(tid: string, exerciseId: string, answerHash: string, exp: number): ReserveOutcome {
    const k = ReplayStore.key(tid, exerciseId);
    const existing = this.map.get(k);

    if (existing && !this.isExpired(existing)) {
      if (existing.state === "pending" && this.now() - existing.reservedAtMs > this.pendingTimeoutMs) {
        existing.state = "failed_retryable"; // stale: crashed or hung mid-grading
      }
      switch (existing.state) {
        case "pending":
          return { kind: "in_progress", retryAfterSec: 2 };
        case "done":
          return { kind: "already_graded", result: existing.result! };
        case "failed_retryable":
          if (existing.answerHash !== answerHash) return { kind: "answer_locked" };
          existing.state = "pending";
          existing.reservedAtMs = this.now();
          return { kind: "reserved" };
      }
    }
    if (existing) this.map.delete(k); // expired record for this key

    if (this.map.size >= this.max) {
      this.sweep();
      if (this.map.size >= this.max) return { kind: "capacity", retryAfterSec: this.retryAfter() };
    }
    this.map.set(k, { state: "pending", answerHash, exp, reservedAtMs: this.now() });
    return { kind: "reserved" };
  }

  /** Stores the final result. Later requests receive this exact result. */
  complete(tid: string, exerciseId: string, result: GradeResult): void {
    const e = this.map.get(ReplayStore.key(tid, exerciseId));
    if (!e) return;
    e.state = "done";
    e.result = result;
  }

  /** Grading failed (AI error/timeout). Only the same answer may retry. */
  fail(tid: string, exerciseId: string): void {
    const e = this.map.get(ReplayStore.key(tid, exerciseId));
    if (!e || e.state !== "pending") return;
    e.state = "failed_retryable";
  }

  /** Whether a NEW exercise set may be issued (fails closed at the high-water mark). */
  canIssueNewSet(): IssueOutcome {
    const limit = Math.max(1, Math.floor(this.max * this.highWater));
    if (this.map.size >= limit) {
      this.sweep();
      if (this.map.size >= limit) return { ok: false, retryAfterSec: this.retryAfter() };
    }
    return { ok: true };
  }

  /** Test/diagnostic helper. */
  peekState(tid: string, exerciseId: string): ReplayState | undefined {
    return this.map.get(ReplayStore.key(tid, exerciseId))?.state;
  }

  startSweeper(intervalMs = 60_000): void {
    this.stopSweeper();
    this.timer = setInterval(() => this.sweep(), intervalMs);
    this.timer.unref();
  }

  stopSweeper(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** HMAC-SHA256 of the NORMALIZED answer, so raw answers are never stored in the replay store. */
export function createAnswerHasher(secret: Buffer): (normalizedAnswer: string) => string {
  const key = Buffer.from(hkdfSync("sha256", secret, Buffer.from("sciora-answer-hash-v1"), "sciora:answer-hash", 32));
  return (normalizedAnswer) => createHmac("sha256", key).update(normalizedAnswer, "utf8").digest("hex");
}
