import type {
  GeneratedKnowledgeAnswer,
  KnowledgeMeta,
  KnowledgeQueryRequest,
  PublicSource,
  TransformOutput,
  TransformRequest,
} from "./schemas.ts";

export { ProviderError } from "../ai/provider.ts";
import type { NoticeCode } from "../notices.ts";

/**
 * Knowledge Explorer provider abstraction (separate from Phase 1's AIProvider,
 * so Phase 1 code and tests are untouched).
 */
export interface KnowledgeAnswerInput {
  request: KnowledgeQueryRequest;
  /** Server-retrieved, sanitized sources. Empty when no retrieval happened. */
  sources: PublicSource[];
}

export interface KnowledgeProvider {
  readonly name: "anthropic" | "demo";
  readonly simulated: boolean;
  readonly models: { learn: string; fast: string } | null;
  answer(input: KnowledgeAnswerInput): Promise<{ answer: GeneratedKnowledgeAnswer; meta: KnowledgeMeta; notices?: NoticeCode[] }>;
  transform(req: TransformRequest): Promise<{ output: TransformOutput; meta: KnowledgeMeta; notices?: NoticeCode[] }>;
}
