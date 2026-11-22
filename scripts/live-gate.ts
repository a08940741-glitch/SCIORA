import { loadConfig, type Config } from "../src/config.ts";

/**
 * Guard for scripts that make REAL API calls (billed with Anthropic; free-tier quota with Groq).
 * All three are required: SCIORA_ALLOW_LIVE_TESTS=1, SCIORA_AI_MODE=live, and the selected
 * provider's key (ANTHROPIC_API_KEY, or GROQ_API_KEY with SCIORA_AI_PROVIDER=groq).
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
  const providerKey = config.aiProvider === "groq" ? config.groqApiKey : config.anthropicApiKey;
  if (!config.allowLiveTests || config.aiMode !== "live" || !providerKey) {
    console.error(
      `${scriptName}: REFUSED. This script makes real AI calls (billed with Anthropic; using the free-tier quota with Groq).\n` +
        `It runs only when SCIORA_ALLOW_LIVE_TESTS=1, SCIORA_AI_MODE=live and the selected provider's key\n` +
        `(ANTHROPIC_API_KEY, or GROQ_API_KEY with SCIORA_AI_PROVIDER=groq) are all set,\n` +
        `and only with the project owner's explicit approval. No API call was made.`,
    );
    process.exit(2);
  }
  return config;
}
