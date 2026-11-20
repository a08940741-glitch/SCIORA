import { T } from "./i18n.js";

/**
 * Localized message for a failed API call (moved unchanged from app.js so that the
 * Knowledge Explorer and the learning assistant share it).
 * 422 unreadable_answer keeps the server's localized hint.
 */
export function errorMessage(r) {
  if (r.status === 0) return T.errors.network;
  const code = r.data?.error;
  if (code === "unreadable_answer" && r.data?.message) return r.data.message;
  return T.errorCodes[code] ?? r.data?.message ?? T.errors.generic;
}
