import type { NoticeCode } from "../notices.ts";
import type {
  GeneratedLesson,
  Language,
  LessonRequest,
  Level,
  Meta,
  ShortTextExercise,
  Subject,
  WrittenJudgement,
} from "../domain/schemas.ts";

/**
 * Provider abstraction. The rest of SCIORA never talks to an AI vendor directly.
 *  - AnthropicProvider: real Claude models (live mode only).
 *  - GroqProvider: open models on Groq's free tier (live mode only).
 *  - DemoProvider: pre-written, clearly labelled SIMULATED content. No network.
 */

export interface LessonOutput {
  lesson: GeneratedLesson;
  meta: Meta;
  /** System notices (codes translated by the UI). */
  notices?: NoticeCode[];
}

export interface JudgeInput {
  exercise: ShortTextExercise;
  /** Original student text (not normalized). */
  answer: string;
  language: Language;
  subject: Subject;
  level: Level;
}

export type ModelTier = "learn" | "fast";

export interface JudgeOutput {
  judgement: WrittenJudgement;
  source: "anthropic" | "groq" | "demo";
  simulated: boolean;
  model: string | null;
  fallbackUsed: boolean;
  method: "rubric_ai" | "demo_keywords";
}

export interface AIProvider {
  readonly name: "anthropic" | "groq" | "demo";
  readonly simulated: boolean;
  /** Models this provider would use (for /api/health). Null in demo mode. */
  readonly models: { learn: string; fast: string } | null;
  generateLesson(req: LessonRequest): Promise<LessonOutput>;
  judgeWritten(input: JudgeInput, tier: ModelTier): Promise<JudgeOutput>;
}

export type ProviderErrorCode =
  | "refusal"
  | "rate_limited"
  | "unavailable"
  | "misconfigured"
  | "bad_output"
  | "not_in_demo";

const STATUS: Record<ProviderErrorCode, number> = {
  refusal: 422,
  rate_limited: 429,
  unavailable: 503,
  misconfigured: 503,
  bad_output: 502,
  not_in_demo: 404,
};

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get httpStatus(): number {
    return STATUS[this.code];
  }
}
