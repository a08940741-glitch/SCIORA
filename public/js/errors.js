import { T } from "./i18n.js";

/**
 * Localized message for a failed API call (moved unchanged from app.js so that the
 * Knowledge Explorer and the learning assistant share it).
 * 422 unreadable_answer: a format hint in the interface language, chosen by exercise type.
 */
export function errorMessage(r, ctx = {}) {
  if (r.status === 0) return T.errors.network;
  const code = r.data?.error;
  if (code === "unreadable_answer") return T.unreadable[ctx.exerciseType] ?? r.data?.message ?? T.errors.generic;
  const base = T.errorCodes[code] ?? r.data?.message ?? T.errors.generic;
  // Tell the user how long to wait when the server says so (rate limit, capacity, busy AI).
  const waitCodes = ["rate_limited", "capacity_exceeded", "grading_in_progress"];
  return r.retryAfter && waitCodes.includes(code) ? `${base} ${T.errors.retryAfter(Math.ceil(r.retryAfter))}` : base;
}
