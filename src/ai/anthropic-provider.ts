import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GeneratedLesson, WrittenJudgement, type LessonRequest } from "../domain/schemas.ts";
import { JUDGE_SYSTEM_PROMPT, LESSON_SYSTEM_PROMPT, judgeUserMessage, lessonUserMessage } from "./prompts.ts";
import {
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

// Moved to ./structured-call.ts (D2, behaviour-preserving); re-exported for existing imports.
import { callStructured, type MessagesClient } from "./structured-call.ts";
export { FALLBACK_BETA, mapSdkError, supportsServerFallback, type MessagesClient } from "./structured-call.ts";

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

  async generateLesson(req: LessonRequest): Promise<LessonOutput> {
    const r = await callStructured(this.client, this.timeoutMs, {
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
    const r = await callStructured(this.client, this.timeoutMs, {
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
