import type { Config } from "../src/config.ts";

/**
 * Offline readiness assessment for a controlled live AI test. Pure function: reads the loaded
 * configuration only. It makes NO network request and never includes a key (or its length).
 */
export interface Readiness {
  ready: boolean;
  lines: string[];
  problems: string[];
  warnings: string[];
}

export const PROVIDER_HOSTS: Record<Config["aiProvider"], string> = {
  anthropic: "api.anthropic.com",
  groq: "api.groq.com",
};

export function assessLiveReadiness(config: Config): Readiness {
  const problems: string[] = [];
  const warnings: string[] = [];
  const provider = config.aiProvider;
  const models = provider === "groq" ? config.groqModels : config.models;
  const keySet = provider === "groq" ? !!config.groqApiKey : !!config.anthropicApiKey;
  const keyVar = provider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY";

  if (config.aiMode !== "live") problems.push("SCIORA_AI_MODE is not \"live\" (SCIORA is in demo mode; no AI calls will be made).");
  if (!keySet) problems.push(`${keyVar} is not set for the selected provider (${provider}).`);
  if (!config.allowLiveTests) problems.push("SCIORA_ALLOW_LIVE_TESTS is not 1 (the live test script will refuse to run).");

  if (config.dailyLimit === 0) warnings.push("SCIORA_DAILY_LIMIT is 0 (no daily cap). Set a small cap, e.g. 20, before any live session.");
  if (config.rateLimitPerMinute > 10) warnings.push(`SCIORA_RATE_LIMIT_PER_MINUTE is ${config.rateLimitPerMinute}. For a shared free tier, consider 10 or less.`);
  if (provider === "anthropic") warnings.push("Anthropic is a PAID service. The project budget is 0 MAD: use SCIORA_AI_PROVIDER=groq unless the owner approves spending.");
  if (provider === "groq") warnings.push("Groq free-tier limits are shown only in the Groq console and can change; the account holder must be 18 or older.");
  if (config.gradeEscalation) warnings.push("SCIORA_GRADE_ESCALATION is on: an uncertain written answer triggers a second AI call.");

  const lines = [
    `AI mode:            ${config.aiMode}`,
    `Provider:           ${provider}`,
    `Models:             learn=${models.learn}  fast=${models.fast}  reason=${models.reason}`,
    `${keyVar.padEnd(19)} ${keySet ? "set (value hidden)" : "NOT set"}`,
    `Live tests allowed: ${config.allowLiveTests ? "yes" : "no"}`,
    `Daily AI cap:       ${config.dailyLimit === 0 ? "none" : config.dailyLimit}`,
    `Rate limit:         ${config.rateLimitPerMinute} requests/minute per IP`,
    `Retriever:          ${config.retriever}`,
    `Network host needed: ${PROVIDER_HOSTS[provider]} (must be reachable from this machine)`,
  ];
  return { ready: problems.length === 0, lines, problems, warnings };
}
