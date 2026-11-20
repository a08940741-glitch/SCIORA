import type { FastifyReply } from "fastify";

/**
 * Shared HTTP helpers. Moved verbatim from app.ts (behaviour-preserving) so that the
 * Phase 1 routes and the Knowledge Explorer routes share ONE daily AI budget and the
 * same error format.
 */

/** Counts AI calls per UTC day (live mode only) to cap cost. 0 = unlimited. */
export class DailyBudget {
  private day = "";
  private count = 0;
  constructor(private readonly limit: number, private readonly now: () => number) {}
  take(): boolean {
    if (this.limit <= 0) return true;
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count++;
    return true;
  }
}

export function sendError(reply: FastifyReply, status: number, error: string, message: string, retryAfterSec?: number, extra: Record<string, unknown> = {}) {
  if (retryAfterSec !== undefined) reply.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterSec))));
  return reply.code(status).send({ error, message, ...extra });
}
