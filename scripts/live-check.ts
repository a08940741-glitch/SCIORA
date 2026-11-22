/**
 * OFFLINE live-AI readiness check. Makes NO network request and never prints a key.
 *
 *   npm run live:check
 *
 * Exit codes: 0 = ready for a controlled live test, 1 = not ready, 2 = configuration error.
 */
import { ConfigError, loadConfig } from "../src/config.ts";
import { assessLiveReadiness } from "./live-readiness.ts";

let config;
try {
  config = loadConfig();
} catch (err) {
  // ConfigError messages name variables only, never values.
  console.error(`live:check: configuration error: ${err instanceof ConfigError ? err.message : "unknown error"}`);
  process.exit(2);
}

const r = assessLiveReadiness(config);
console.log("SCIORA live AI readiness (offline check: no network request was made)\n");
for (const line of r.lines) console.log(`  ${line}`);
if (r.problems.length) {
  console.log("\nNot ready:");
  for (const p of r.problems) console.log(`  ✗ ${p}`);
}
if (r.warnings.length) {
  console.log("\nWarnings:");
  for (const w of r.warnings) console.log(`  ! ${w}`);
}
console.log(r.ready ? "\nREADY for a controlled live test (see docs/LIVE_AI_SETUP.md)." : "\nNOT READY. Nothing was sent anywhere.");
process.exit(r.ready ? 0 : 1);
