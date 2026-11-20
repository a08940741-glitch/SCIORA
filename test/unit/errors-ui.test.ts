import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES modules, tested directly in Node.
import { errorMessage } from "../../public/js/errors.js";
// @ts-ignore
import { T } from "../../public/js/i18n.js";

test("network failure → localized network message", () => {
  assert.equal(errorMessage({ status: 0, data: { error: "network" }, retryAfter: null }), T.errors.network);
});

test("known codes → Darija message; unknown → server message → generic", () => {
  assert.equal(errorMessage({ status: 404, data: { error: "not_in_demo" }, retryAfter: null }), T.errorCodes.not_in_demo);
  assert.equal(errorMessage({ status: 500, data: { error: "weird", message: "srv" }, retryAfter: null }), "srv");
  assert.equal(errorMessage({ status: 500, data: null, retryAfter: null }), T.errors.generic);
});

test("unreadable_answer keeps the server's localized hint", () => {
  assert.equal(errorMessage({ status: 422, data: { error: "unreadable_answer", message: "hint" }, retryAfter: null }), "hint");
});

test("Retry-After is shown in seconds/minutes for rate limit and capacity only", () => {
  assert.match(errorMessage({ status: 429, data: { error: "rate_limited" }, retryAfter: 12 }), /12 ثانية/);
  assert.match(errorMessage({ status: 503, data: { error: "capacity_exceeded" }, retryAfter: 361 }), /7 دقيقة/);
  assert.doesNotMatch(errorMessage({ status: 503, data: { error: "unavailable" }, retryAfter: 30 }), /ثانية|دقيقة/);
});
