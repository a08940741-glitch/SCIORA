import { callGroqStructured, type GroqClient } from "../ai/groq-client.ts";
import type { PublicSource } from "../knowledge/schemas.ts";
import { EVIDENCE_SYSTEM_PROMPT, evidenceUserMessage } from "./prompts.ts";
import type { EvidenceProvider } from "./provider.ts";
import { GeneratedClaimAnalysis, type EvidenceRequest } from "./schemas.ts";

/**
 * Evidence Analyzer on Groq (open models, free tier). Constructed only in live mode with
 * SCIORA_AI_PROVIDER=groq. Same prompt and schema as AnthropicEvidenceProvider; quotes and
 * verdicts are still checked and computed by the server (EvidenceService).
 * NOT yet exercised against the real API (no live calls without owner approval).
 */
export const GROQ_EVIDENCE_MAX_TOKENS = 8192;

export class GroqEvidenceProvider implements EvidenceProvider {
  readonly name = "groq" as const;
  readonly simulated = false;
  readonly model: string;
  private readonly client: GroqClient;
  private readonly timeoutMs: number;

  constructor(opts: { client: GroqClient; model: string; timeoutMs?: number }) {
    this.client = opts.client;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  async analyze(input: { request: EvidenceRequest; sources: PublicSource[] }) {
    const r = await callGroqStructured(this.client, this.timeoutMs, {
      model: this.model,
      effort: "medium",
      system: EVIDENCE_SYSTEM_PROMPT,
      user: evidenceUserMessage(input.request, input.sources),
      schemaName: "sciora_claim_analysis",
      schema: GeneratedClaimAnalysis,
      maxTokens: GROQ_EVIDENCE_MAX_TOKENS,
    });
    return { analysis: r.data, meta: { source: "groq" as const, simulated: false, model: r.model, fallbackUsed: false, generatedAt: new Date().toISOString() } };
  }
}
