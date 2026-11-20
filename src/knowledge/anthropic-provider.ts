import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { callStructured, type MessagesClient } from "../ai/structured-call.ts";
import type { KnowledgeAnswerInput, KnowledgeProvider } from "./provider.ts";
import { KNOWLEDGE_SYSTEM_PROMPT, knowledgeUserMessage, transformSystemPrompt, transformUserMessage } from "./prompts.ts";
import {
  ExamplesOutput,
  GeneratedKnowledgeAnswer,
  QuizOutput,
  SimplifyOutput,
  type KnowledgeMeta,
  type TransformOutput,
  type TransformRequest,
} from "./schemas.ts";

/**
 * Live Knowledge Explorer provider (Claude). Constructed only in live mode.
 * Answers use the LEARN tier; transforms (simplify / examples / quiz) use the FAST tier.
 * NOT yet exercised against the real API (no live calls without owner approval).
 */
export class AnthropicKnowledgeProvider implements KnowledgeProvider {
  readonly name = "anthropic" as const;
  readonly simulated = false;
  readonly models: { learn: string; fast: string };
  private readonly client: MessagesClient;
  private readonly timeoutMs: number;

  constructor(opts: { client: MessagesClient; models: { learn: string; fast: string }; timeoutMs?: number }) {
    this.client = opts.client;
    this.models = opts.models;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  private meta(model: string, fallbackUsed: boolean): KnowledgeMeta {
    return { source: "anthropic", simulated: false, model, fallbackUsed, generatedAt: new Date().toISOString() };
  }

  async answer(input: KnowledgeAnswerInput) {
    const r = await callStructured(this.client, this.timeoutMs, {
      model: this.models.learn,
      effort: "medium",
      system: KNOWLEDGE_SYSTEM_PROMPT,
      user: knowledgeUserMessage(input.request, input.sources),
      format: betaZodOutputFormat(GeneratedKnowledgeAnswer),
      validate: (v) => GeneratedKnowledgeAnswer.safeParse(v),
      maxTokens: 16000,
    });
    return { answer: r.data, meta: this.meta(r.model, r.fallbackUsed) };
  }

  async transform(req: TransformRequest): Promise<{ output: TransformOutput; meta: KnowledgeMeta }> {
    const common = { model: this.models.fast, effort: "low" as const, system: transformSystemPrompt(req.mode), user: transformUserMessage(req), maxTokens: 8000 };
    switch (req.mode) {
      case "simplify": {
        const r = await callStructured(this.client, this.timeoutMs, { ...common, format: betaZodOutputFormat(SimplifyOutput), validate: (v) => SimplifyOutput.safeParse(v) });
        return { output: { mode: "simplify", data: r.data }, meta: this.meta(r.model, r.fallbackUsed) };
      }
      case "examples": {
        const r = await callStructured(this.client, this.timeoutMs, { ...common, format: betaZodOutputFormat(ExamplesOutput), validate: (v) => ExamplesOutput.safeParse(v) });
        return { output: { mode: "examples", data: r.data }, meta: this.meta(r.model, r.fallbackUsed) };
      }
      case "quiz": {
        const r = await callStructured(this.client, this.timeoutMs, { ...common, format: betaZodOutputFormat(QuizOutput), validate: (v) => QuizOutput.safeParse(v) });
        return { output: { mode: "quiz", data: r.data }, meta: this.meta(r.model, r.fallbackUsed) };
      }
    }
  }
}
