import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES modules, tested directly in Node.
import { errorMessage } from "../../public/js/errors.js";
// @ts-ignore
import { T, DICTIONARIES } from "../../public/js/i18n.js";

test("network failure → localized network message", () => {
  assert.equal(errorMessage({ status: 0, data: { error: "network" }, retryAfter: null }), T.errors.network);
});

test("known codes → Darija message; unknown → server message → generic", () => {
  assert.equal(errorMessage({ status: 404, data: { error: "not_in_demo" }, retryAfter: null }), T.errorCodes.not_in_demo);
  assert.equal(errorMessage({ status: 500, data: { error: "weird", message: "srv" }, retryAfter: null }), "srv");
  assert.equal(errorMessage({ status: 500, data: null, retryAfter: null }), T.errors.generic);
});


test("Retry-After is shown in seconds/minutes for rate limit and capacity only (English default)", () => {
  assert.match(errorMessage({ status: 429, data: { error: "rate_limited" }, retryAfter: 12 }), /Try again in 12 seconds/);
  assert.match(errorMessage({ status: 503, data: { error: "capacity_exceeded" }, retryAfter: 361 }), /Try again in 7 minutes/);
  assert.doesNotMatch(errorMessage({ status: 503, data: { error: "unavailable" }, retryAfter: 30 }), /Try again in/);
});

test("English-only: one interface dictionary; the english_only code maps to the exact English notice", () => {
  assert.deepEqual(Object.keys(DICTIONARIES), ["en"]);
  assert.equal(
    errorMessage({ status: 422, data: { error: "english_only", message: "x" } }),
    "SCIORA currently supports English only. Please submit your question in English to continue.",
  );
});

test("unreadable answer → interface-language hint chosen by exercise type", () => {
  const r = { status: 422, data: { error: "unreadable_answer", message: "server hint" }, retryAfter: null };
  assert.equal(errorMessage(r, { exerciseType: "numeric" }), T.unreadable.numeric);
  assert.equal(errorMessage(r, { exerciseType: "expression" }), T.unreadable.expression);
  assert.equal(errorMessage(r), "server hint", "falls back to the server message without a type");
});
