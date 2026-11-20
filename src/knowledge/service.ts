import type { KnowledgeProvider } from "./provider.ts";
import type { SourceRetriever } from "./retriever.ts";
import { NoopRetriever } from "./retriever.ts";
import {
  type GeneratedKnowledgeAnswer,
  type KnowledgeMeta,
  type KnowledgeQueryRequest,
  type KnowledgeQueryResponse,
  type TransformRequest,
  type TransformResponse,
  type PublicSource,
  type RetrievedSource,
  type Verification,
} from "./schemas.ts";
import { finalizeAnswer, MAX_SOURCES, sanitizeSources } from "./sources.ts";
import { checkTransform } from "./learning.ts";
import { ProviderError } from "./provider.ts";

export { MAX_SOURCES };

/**
 * Knowledge Explorer core service.
 *   question → (optional) retrieval with timeout → provider answer → validated draft
 * Sources are sanitized and the verification status is decided by sources.ts.
 */

export const DEFAULT_RETRIEVAL_TIMEOUT_MS = 8000;

export interface RetrievalOutcome {
  sources: PublicSource[];
  performed: boolean;
  note: Verification["retrievalNote"];
  retriever: string | null;
}

export interface KnowledgeDraft {
  generated: GeneratedKnowledgeAnswer;
  meta: KnowledgeMeta;
  retrieval: RetrievalOutcome;
  notices?: string[];
}

export interface KnowledgeServiceOptions {
  provider: KnowledgeProvider;
  retriever?: SourceRetriever;
  retrievalTimeoutMs?: number;
  now?: () => number;
  /** Converts raw retrieved items into public sources. Defaults to sanitizeSources. */
  prepareSources?: (raw: RetrievedSource[], retrievedAt: string, retriever: string) => PublicSource[];
}

/**
 * Shared retrieval step (used by Knowledge Explorer and Evidence Analyzer).
 * Moved verbatim from KnowledgeService.retrieve (behaviour-preserving).
 * Never runs for a simulated (demo) provider or a disabled retriever; aborts on timeout;
 * failures degrade to "no sources" instead of failing the request.
 */
export async function runRetrieval(opts: {
  simulated: boolean;
  retriever: SourceRetriever;
  query: string;
  language: string;
  timeoutMs: number;
  now: () => number;
  prepare: NonNullable<KnowledgeServiceOptions["prepareSources"]>;
}): Promise<RetrievalOutcome> {
  if (opts.simulated) return { sources: [], performed: false, note: "demo", retriever: null };
  if (!opts.retriever.enabled) return { sources: [], performed: false, note: "disabled", retriever: null };

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, opts.timeoutMs);
  });
  try {
    const raced = await Promise.race([
      opts.retriever.search(opts.query, { language: opts.language, limit: MAX_SOURCES, signal: controller.signal }),
      timeout,
    ]);
    if (raced === "timeout") return { sources: [], performed: false, note: "timeout", retriever: opts.retriever.name };
    const retrievedAt = new Date(opts.now()).toISOString();
    const sources = opts.prepare(Array.isArray(raced) ? raced : [], retrievedAt, opts.retriever.name);
    return sources.length
      ? { sources, performed: true, note: null, retriever: opts.retriever.name }
      : { sources: [], performed: true, note: "no_results", retriever: opts.retriever.name };
  } catch {
    return { sources: [], performed: false, note: "failed", retriever: opts.retriever.name };
  } finally {
    clearTimeout(timer);
  }
}

export class KnowledgeService {
  readonly provider: KnowledgeProvider;
  readonly retriever: SourceRetriever;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly prepare: NonNullable<KnowledgeServiceOptions["prepareSources"]>;

  constructor(opts: KnowledgeServiceOptions) {
    this.provider = opts.provider;
    this.retriever = opts.retriever ?? new NoopRetriever();
    this.timeoutMs = opts.retrievalTimeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.prepare = opts.prepareSources ?? sanitizeSources;
  }

  /** Runs retrieval if (and only if) a real provider and an enabled retriever are configured. */
  async retrieve(req: KnowledgeQueryRequest): Promise<RetrievalOutcome> {
    return runRetrieval({
      simulated: this.provider.simulated,
      retriever: this.retriever,
      query: req.question,
      language: req.language,
      timeoutMs: this.timeoutMs,
      now: this.now,
      prepare: this.prepare,
    });
  }

  /** Retrieval → provider. Provider errors propagate (mapped to HTTP by the route). */
  async draft(req: KnowledgeQueryRequest): Promise<KnowledgeDraft> {
    const retrieval = await this.retrieve(req);
    const { answer, meta, notices } = await this.provider.answer({ request: req, sources: retrieval.sources });
    return { generated: answer, meta, retrieval, notices: notices ?? [] };
  }

  /** Full pipeline: retrieval → provider → server-side source validation + verification status. */
  async query(req: KnowledgeQueryRequest): Promise<KnowledgeQueryResponse> {
    return finalizeAnswer(await this.draft(req), this.provider.simulated);
  }

  /**
   * Learning mode: simplify / examples / self-check quiz.
   * Independent of Phase 1 grading: nothing is sealed, graded or recorded.
   */
  async transform(req: TransformRequest): Promise<TransformResponse> {
    const { output, meta, notices } = await this.provider.transform(req);
    const checked = checkTransform(output);
    if (!checked.ok) throw new ProviderError("bad_output", "The AI quiz did not pass SCIORA's checks.");
    const all = [...(notices ?? []), ...(checked.dropped > 0 ? ["quiz_questions_removed"] : [])];
    return { mode: checked.output.mode, result: checked.output.data, selfCheckOnly: checked.output.mode === "quiz", meta, notices: all };
  }
}
