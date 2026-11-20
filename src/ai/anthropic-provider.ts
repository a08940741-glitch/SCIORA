import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GeneratedLesson, WrittenJudgement, type LessonRequest } from "../domain/schemas.ts";
import { JUDGE_SYSTEM_PROMPT, LESSON_SYSTEM_PROMPT, judgeUserMessage, lessonUserMessage } from "./prompts.ts";
import {
  ProviderError,
  type AIProvider,
  type JudgeInput,
  type JudgeOutput,
  type LessonOutput,
  type ModelTier,
} from "./provider.ts";

/**
 * Real AI provider (Claude via the official Anthropic SDK).
 * Constructed ONLY when SCIORA_AI_MODE=live and a key is configured (see ai/index.ts).
 *
 * - Structured outputs (`output_config.format`) force JSON matching our zod schemas;
 *   the result is validated again locally before use.
 * - Server-side refusal fallback ("default") is requested on models that support it.
 *   NOTE: the combination of structured outputs + server-side fallback has NOT been
 *   verified against the live API yet (no live calls without owner approval).
 * - stop_reason is always checked: refusal → polite error; max_tokens / invalid output →
 *   one retry, then error. Partial output is never shown.
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

export interface AnthropicProviderOptions {
  client: MessagesClient;
  models: { learn: string; fast: string };
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  readonly simulated = false;
  readonly models: { learn: string; fast: string };
  private readonly client: MessagesClient;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicProviderOptions) {
    this.client = opts.client;
    this.models = opts.models;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  private async callStructured<T>(args: {
    model: string;
    effort: "low" | "medium" | "high";
    system: string;
    user: string;
    format: ReturnType<typeof betaZodOutputFormat>;
    validate: (v: unknown) => { success: true; data: T } | { success: false };
    maxTokens: number;
  }): Promise<{ data: T; model: string; fallbackUsed: boolean }> {
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
        res = await this.client.beta.messages.parse(params, { timeout: this.timeoutMs });
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

  async generateLesson(req: LessonRequest): Promise<LessonOutput> {
    const r = await this.callStructured({
      model: this.models.learn,
      effort: "medium",
      system: LESSON_SYSTEM_PROMPT,
      user: lessonUserMessage(req),
      format: betaZodOutputFormat(GeneratedLesson),
      validate: (v) => GeneratedLesson.safeParse(v),
      maxTokens: 16000,
    });
    return {
      lesson: r.data,
      meta: { source: "anthropic", simulated: false, model: r.model, fallbackUsed: r.fallbackUsed, generatedAt: new Date().toISOString() },
    };
  }

  async judgeWritten(input: JudgeInput, tier: ModelTier): Promise<JudgeOutput> {
    const model = tier === "learn" ? this.models.learn : this.models.fast;
    const r = await this.callStructured({
      model,
      effort: tier === "learn" ? "medium" : "low",
      system: JUDGE_SYSTEM_PROMPT,
      user: judgeUserMessage(input),
      format: betaZodOutputFormat(WrittenJudgement),
      validate: (v) => WrittenJudgement.safeParse(v),
      maxTokens: 8000,
    });
    return { judgement: r.data, source: "anthropic", simulated: false, model: r.model, fallbackUsed: r.fallbackUsed, method: "rubric_ai" };
  }
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
