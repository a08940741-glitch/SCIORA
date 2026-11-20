import Anthropic from "@anthropic-ai/sdk";
import type { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ProviderError } from "./provider.ts";

/**
 * Shared structured-output call used by every Anthropic-backed provider
 * (Phase 1 AnthropicProvider and Phase 2A AnthropicKnowledgeProvider).
 *
 * Moved verbatim from AnthropicProvider (behaviour-preserving refactor, decision D2):
 * - structured outputs (`output_config.format`) + local re-validation;
 * - server-side refusal fallback on supported models (NOT yet verified against the live API);
 * - refusal → ProviderError("refusal"); max_tokens / invalid output → one retry, then "bad_output";
 * - SDK errors mapped by mapSdkError (most specific first). Partial output is never returned.
 */

/** Minimal client surface we use; lets tests inject a fake client (no network). */
export interface MessagesClient {
  beta: { messages: { parse: (params: any, options?: any) => Promise<any> } };
}

const SERVER_FALLBACK_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1"];
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function supportsServerFallback(model: string): boolean {
  return SERVER_FALLBACK_MODELS.includes(model);
}

export interface StructuredCallArgs<T> {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  user: string;
  format: ReturnType<typeof betaZodOutputFormat>;
  validate: (v: unknown) => { success: true; data: T } | { success: false };
  maxTokens: number;
}

export async function callStructured<T>(
  client: MessagesClient,
  timeoutMs: number,
  args: StructuredCallArgs<T>,
): Promise<{ data: T; model: string; fallbackUsed: boolean }> {
  const params: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
    output_config: { effort: args.effort, format: args.format },
  };
  if (supportsServerFallback(args.model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: any;
    try {
      res = await client.beta.messages.parse(params, { timeout: timeoutMs });
    } catch (err) {
      throw mapSdkError(err);
    }
    if (res?.stop_reason === "refusal") {
      throw new ProviderError("refusal", "The AI declined this request.");
    }
    if (res?.stop_reason === "max_tokens") {
      if (attempt === 2) throw new ProviderError("bad_output", "The AI response was too long and was cut off.");
      continue;
    }
    const checked = args.validate(res?.parsed_output);
    if (!checked.success) {
      if (attempt === 2) throw new ProviderError("bad_output", "The AI response did not match the expected format.");
      continue;
    }
    const iterations: any[] = Array.isArray(res?.usage?.iterations) ? res.usage.iterations : [];
    const fallbackUsed = iterations.some((i) => i?.type === "fallback_message") || (typeof res?.model === "string" && res.model !== args.model);
    return { data: checked.data, model: typeof res?.model === "string" ? res.model : args.model, fallbackUsed };
  }
  throw new ProviderError("bad_output", "The AI response could not be used.");
}

/** Maps SDK errors (most specific first) to SCIORA errors. Never includes key material. */
export function mapSdkError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    const ra = Number(err.headers?.get?.("retry-after"));
    return new ProviderError("rate_limited", "SCIORA is busy. Please try again shortly.", Number.isFinite(ra) && ra > 0 ? ra : 30);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("misconfigured", "The AI service is not configured correctly.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("unavailable", "The AI service could not be reached.");
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new ProviderError("unavailable", "The AI service is temporarily unavailable.");
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError("bad_output", "The AI service returned an error.");
  }
  return new ProviderError("unavailable", "The AI service failed unexpectedly.");
}
