import { loadConfig, type Config } from "../src/config.ts";

/**
 * Guard for scripts that make REAL, BILLED API calls.
 * All three are required: SCIORA_ALLOW_LIVE_TESTS=1, SCIORA_AI_MODE=live, ANTHROPIC_API_KEY.
 * Project rule: these scripts are run only with the project owner's explicit approval.
 */
export function requireLiveApproval(scriptName: string): Config {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`${scriptName}: configuration error: ${(err as Error).message}`);
    process.exit(2);
  }
  if (!config.allowLiveTests || config.aiMode !== "live" || !config.anthropicApiKey) {
    console.error(
      `${scriptName}: REFUSED. This script makes real, billed AI calls.\n` +
        `It runs only when SCIORA_ALLOW_LIVE_TESTS=1, SCIORA_AI_MODE=live and ANTHROPIC_API_KEY are all set,\n` +
        `and only with the project owner's explicit approval. No API call was made.`,
    );
    process.exit(2);
  }
  return config;
}
