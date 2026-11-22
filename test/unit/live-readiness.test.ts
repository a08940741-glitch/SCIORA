import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../../src/config.ts";
import { assessLiveReadiness } from "../../scripts/live-readiness.ts";
import { FAKE_GROQ_KEY } from "../helpers/fake-groq.ts";

const GROQ_LIVE = { SCIORA_AI_MODE: "live", SCIORA_AI_PROVIDER: "groq", GROQ_API_KEY: FAKE_GROQ_KEY, SCIORA_ALLOW_LIVE_TESTS: "1", SCIORA_DAILY_LIMIT: "20", SCIORA_RATE_LIMIT_PER_MINUTE: "10" };

test("readiness: demo mode (default) is NOT ready and says no AI calls will be made", () => {
  const r = assessLiveReadiness(loadConfig({}));
  assert.equal(r.ready, false);
  assert.ok(r.problems.some((p) => /demo mode/.test(p)));
});

test("readiness: complete Groq live config with caps is ready; key is reported as set but never shown", () => {
  const r = assessLiveReadiness(loadConfig(GROQ_LIVE));
  assert.equal(r.ready, true, r.problems.join("; "));
  const text = [...r.lines, ...r.problems, ...r.warnings].join("\n");
  assert.match(text, /GROQ_API_KEY\s+set \(value hidden\)/);
  assert.match(text, /api\.groq\.com/);
  assert.match(text, /openai\/gpt-oss-120b/);
  assert.equal(text.includes(FAKE_GROQ_KEY), false);
  assert.equal(text.includes(String(FAKE_GROQ_KEY.length)), false, "key length not shown either");
});

test("readiness: missing live-test switch blocks; no daily cap and a high rate limit produce warnings", () => {
  const r = assessLiveReadiness(loadConfig({ ...GROQ_LIVE, SCIORA_ALLOW_LIVE_TESTS: "0", SCIORA_DAILY_LIMIT: "0", SCIORA_RATE_LIMIT_PER_MINUTE: "30" }));
  assert.equal(r.ready, false);
  assert.ok(r.problems.some((p) => /SCIORA_ALLOW_LIVE_TESTS/.test(p)));
  assert.ok(r.warnings.some((w) => /SCIORA_DAILY_LIMIT/.test(w)));
  assert.ok(r.warnings.some((w) => /SCIORA_RATE_LIMIT_PER_MINUTE/.test(w)));
});

test("readiness: Anthropic is flagged as PAID against the 0 MAD budget", () => {
  const r = assessLiveReadiness(loadConfig({ SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real", SCIORA_ALLOW_LIVE_TESTS: "1" }));
  assert.ok(r.warnings.some((w) => /PAID/.test(w) && /0 MAD/.test(w)));
  assert.match(r.lines.join("\n"), /api\.anthropic\.com/);
});

function runCheck(env: Record<string, string>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env };
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/live-check.ts"], { env: clean, encoding: "utf8", timeout: 60_000 });
}

test("live:check script (offline): demo → exit 1, states no network request was made", () => {
  const r = runCheck({});
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /no network request was made/);
  assert.match(r.stdout, /NOT READY/);
});

test("live:check script: ready Groq config → exit 0 and the key never appears in output", () => {
  const r = runCheck(GROQ_LIVE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /READY for a controlled live test/);
  assert.equal((r.stdout + r.stderr).includes(FAKE_GROQ_KEY), false);
});

test("live:check script: malformed key → exit 2 with a variable-name-only error", () => {
  const r = runCheck({ ...GROQ_LIVE, GROQ_API_KEY: "bad key with spaces 00000000" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /GROQ_API_KEY/);
  assert.equal(r.stderr.includes("bad key with spaces"), false);
});
