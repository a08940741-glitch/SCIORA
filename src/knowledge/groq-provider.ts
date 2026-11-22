import { callGroqStructured, type GroqClient } from "../ai/groq-client.ts";
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
 * Knowledge Explorer on Groq (open models, free tier). Constructed only in live mode with
 * SCIORA_AI_PROVIDER=groq. Same prompts, schemas and server-side source checks as the
 * Anthropic provider (citations are still re-checked by finalizeAnswer).
 * NOT yet exercised against the real API (no live calls without owner approval).
 */
export const GROQ_KNOWLEDGE_MAX_TOKENS = { answer: 8192, transform: 4096 } as const;

export class GroqKnowledgeProvider implements KnowledgeProvider {
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

  private meta(model: string): KnowledgeMeta {
    return { source: "groq", simulated: false, model, fallbackUsed: false, generatedAt: new Date().toISOString() };
  }

  async answer(input: KnowledgeAnswerInput) {
    const r = await callGroqStructured(this.client, this.timeoutMs, {
      model: this.models.learn,
      effort: "medium",
      system: KNOWLEDGE_SYSTEM_PROMPT,
      user: knowledgeUserMessage(input.request, input.sources),
      schemaName: "sciora_knowledge_answer",
      schema: GeneratedKnowledgeAnswer,
      maxTokens: GROQ_KNOWLEDGE_MAX_TOKENS.answer,
    });
    return { answer: r.data, meta: this.meta(r.model) };
  }

  async transform(req: TransformRequest): Promise<{ output: TransformOutput; meta: KnowledgeMeta }> {
    const common = {
      model: this.models.fast,
      effort: "low" as const,
      system: transformSystemPrompt(req.mode),
      user: transformUserMessage(req),
      maxTokens: GROQ_KNOWLEDGE_MAX_TOKENS.transform,
    };
    switch (req.mode) {
      case "simplify": {
        const r = await callGroqStructured(this.client, this.timeoutMs, { ...common, schemaName: "sciora_simplify", schema: SimplifyOutput });
        return { output: { mode: "simplify", data: r.data }, meta: this.meta(r.model) };
      }
      case "examples": {
        const r = await callGroqStructured(this.client, this.timeoutMs, { ...common, schemaName: "sciora_examples", schema: ExamplesOutput });
        return { output: { mode: "examples", data: r.data }, meta: this.meta(r.model) };
      }
      case "quiz": {
        const r = await callGroqStructured(this.client, this.timeoutMs, { ...common, schemaName: "sciora_quiz", schema: QuizOutput });
        return { output: { mode: "quiz", data: r.data }, meta: this.meta(r.model) };
      }
    }
  }
}
