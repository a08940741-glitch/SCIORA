import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/** Live scripts must refuse to run unless all three switches are set. No network is attempted. */
function run(script: string, env: Record<string, string>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env };
  return spawnSync(process.execPath, ["--import", "tsx", script], { env: clean, encoding: "utf8", timeout: 60_000 });
}

for (const script of ["scripts/eval-grading.ts", "scripts/live-smoke.ts"]) {
  test(`${script} refuses without approval switches`, () => {
    const r = run(script, {});
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /REFUSED/);
    assert.match(r.stderr, /No API call was made/);
  });

  test(`${script} refuses with a key but no SCIORA_ALLOW_LIVE_TESTS`, () => {
    const r = run(script, { SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /REFUSED/);
  });

  test(`${script} refuses with approval switch but demo mode`, () => {
    const r = run(script, { SCIORA_ALLOW_LIVE_TESTS: "1", ANTHROPIC_API_KEY: "test-key-not-real" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /REFUSED/);
  });
}
