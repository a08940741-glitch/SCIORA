import { GeneratedLesson, WrittenJudgement, type LessonRequest } from "../domain/schemas.ts";
import { JUDGE_SYSTEM_PROMPT, LESSON_SYSTEM_PROMPT, judgeUserMessage, lessonUserMessage } from "./prompts.ts";
import { callGroqStructured, type GroqClient } from "./groq-client.ts";
import type { AIProvider, JudgeInput, JudgeOutput, LessonOutput, ModelTier } from "./provider.ts";

/**
 * Learning Assistant on Groq (open models, free tier). Constructed ONLY when
 * SCIORA_AI_MODE=live, SCIORA_AI_PROVIDER=groq and GROQ_API_KEY are set (see ai/index.ts).
 * Same prompts, schemas and server-side checks as AnthropicProvider.
 * NOT yet exercised against the real API (no live calls without owner approval).
 */

/** Output budgets (reasoning tokens count toward them). Kept moderate for free-tier token limits. */
export const GROQ_MAX_TOKENS = { lesson: 8192, judge: 4096 } as const;

export class GroqProvider implements AIProvider {
  readonly name = "groq" as const;
  readonly simulated = false;
  readonly models: { learn: string; fast: string };
  private readonly client: GroqClient;
  private readonly timeoutMs: number;

  constructor(opts: { client: GroqClient; models: { learn: string; fast: string }; timeoutMs?: number }) {
    this.client = opts.client;
    this.models = opts.models;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async generateLesson(req: LessonRequest): Promise<LessonOutput> {
    const r = await callGroqStructured(this.client, this.timeoutMs, {
      model: this.models.learn,
      effort: "medium",
      system: LESSON_SYSTEM_PROMPT,
      user: lessonUserMessage(req),
      schemaName: "sciora_lesson",
      schema: GeneratedLesson,
      maxTokens: GROQ_MAX_TOKENS.lesson,
    });
    return { lesson: r.data, meta: { source: "groq", simulated: false, model: r.model, fallbackUsed: false, generatedAt: new Date().toISOString() } };
  }

  async judgeWritten(input: JudgeInput, tier: ModelTier): Promise<JudgeOutput> {
    const model = tier === "learn" ? this.models.learn : this.models.fast;
    const r = await callGroqStructured(this.client, this.timeoutMs, {
      model,
      effort: tier === "learn" ? "medium" : "low",
      system: JUDGE_SYSTEM_PROMPT,
      user: judgeUserMessage(input),
      schemaName: "sciora_judgement",
      schema: WrittenJudgement,
      maxTokens: GROQ_MAX_TOKENS.judge,
    });
    return { judgement: r.data, source: "groq", simulated: false, model: r.model, fallbackUsed: false, method: "rubric_ai" };
  }
}
