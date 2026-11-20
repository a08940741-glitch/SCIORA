import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError } from "../../src/config.ts";

const SECRET = Buffer.alloc(32, 7).toString("base64");

test("defaults: demo mode, approved model routing, ephemeral secret in development", () => {
  const c = loadConfig({});
  assert.equal(c.aiMode, "demo");
  assert.equal(c.anthropicApiKey, undefined);
  assert.deepEqual(c.models, {
    learn: "claude-sonnet-5-5",
    fast: "claude-haiku-5-5",
    reason: "claude-opus-5-5",
  });
  assert.equal(c.tokenSecretEphemeral, true);
  assert.equal(c.tokenSecret.length, 32);
  assert.equal(c.gradeEscalation, false);
  assert.equal(c.allowLiveTests, false);
});

test("key-alone-does-not-enable-live: an API key without SCIORA_AI_MODE=live stays in demo", () => {
  const c = loadConfig({ ANTHROPIC_API_KEY: "test-key-not-real" });
  assert.equal(c.aiMode, "demo");
  assert.equal(c.anthropicApiKey, undefined, "key must not even be retained in demo mode");
});

test("live mode requires a key", () => {
  assert.throws(() => loadConfig({ SCIORA_AI_MODE: "live" }), ConfigError);
});

test("live mode with key is accepted (configuration only; no network call is made)", () => {
  const c = loadConfig({ SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real" });
  assert.equal(c.aiMode, "live");
  assert.equal(c.anthropicApiKey, "test-key-not-real");
});

test("prod-requires-secret: production refuses to start without SCIORA_TOKEN_SECRET", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /SCIORA_TOKEN_SECRET is required/);
});

test("secret shorter than 32 bytes is rejected", () => {
  assert.throws(
    () => loadConfig({ SCIORA_TOKEN_SECRET: Buffer.alloc(16).toString("base64") }),
    /at least 32 bytes/,
  );
});

test("production with a valid secret works and is not ephemeral", () => {
  const c = loadConfig({ NODE_ENV: "production", SCIORA_TOKEN_SECRET: SECRET });
  assert.equal(c.tokenSecretEphemeral, false);
  assert.deepEqual(c.tokenSecret, Buffer.alloc(32, 7));
});

test("hex secrets are accepted", () => {
  const c = loadConfig({ SCIORA_TOKEN_SECRET: "ab".repeat(32) });
  assert.equal(c.tokenSecret.length, 32);
});

test("model routing is configurable through environment variables", () => {
  const c = loadConfig({
    SCIORA_MODEL_LEARN: "claude-opus-5-5",
    SCIORA_MODEL_FAST: "claude-sonnet-5-5",
    SCIORA_MODEL_REASON: "claude-fable-5-2",
  });
  assert.deepEqual(c.models, { learn: "claude-opus-5-5", fast: "claude-sonnet-5-5", reason: "claude-fable-5-2" });
});

test("invalid model id is rejected", () => {
  assert.throws(() => loadConfig({ SCIORA_MODEL_LEARN: "bad model; rm -rf" }), ConfigError);
});

test("invalid values report variable names only, never values", () => {
  try {
    loadConfig({ PORT: "not-a-number-SECRETVALUE" });
    assert.fail("should throw");
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /PORT/);
    assert.doesNotMatch(err.message, /SECRETVALUE/);
  }
});

test("escalation and live-test switches parse on/off values", () => {
  const c = loadConfig({ SCIORA_GRADE_ESCALATION: "on", SCIORA_ALLOW_LIVE_TESTS: "1" });
  assert.equal(c.gradeEscalation, true);
  assert.equal(c.allowLiveTests, true);
});

test("unknown AI mode is rejected", () => {
  assert.throws(() => loadConfig({ SCIORA_AI_MODE: "turbo" }), ConfigError);
});
