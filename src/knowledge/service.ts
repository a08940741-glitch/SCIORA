import type { KnowledgeProvider } from "./provider.ts";
import type { SourceRetriever } from "./retriever.ts";
import { NoopRetriever } from "./retriever.ts";
import {
  RetrievedSource,
  type GeneratedKnowledgeAnswer,
  type KnowledgeMeta,
  type KnowledgeQueryRequest,
  type PublicSource,
  type Verification,
} from "./schemas.ts";

/**
 * Knowledge Explorer core service.
 *   question → (optional) retrieval with timeout → provider answer → validated draft
 * Source sanitizing and verification are applied by sources.ts (Step 6).
 */

export const MAX_SOURCES = 5;
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
}

export interface KnowledgeServiceOptions {
  provider: KnowledgeProvider;
  retriever?: SourceRetriever;
  retrievalTimeoutMs?: number;
  now?: () => number;
  /** Converts raw retrieved items into public sources (sanitizing). Injected in Step 6. */
  prepareSources?: (raw: RetrievedSource[], retrievedAt: string, retriever: string) => PublicSource[];
}

/** Minimal default: schema-validate, assign server ids. Replaced by sanitizeSources in Step 6. */
function basicPrepare(raw: RetrievedSource[], retrievedAt: string, retriever: string): PublicSource[] {
  const out: PublicSource[] = [];
  for (const item of raw) {
    const p = RetrievedSource.safeParse(item);
    if (!p.success) continue;
    out.push({ ...p.data, id: `S${out.length + 1}`, retrievedAt, retriever });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
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
    this.prepare = opts.prepareSources ?? basicPrepare;
  }

  /** Runs retrieval if (and only if) a real provider and an enabled retriever are configured. */
  async retrieve(req: KnowledgeQueryRequest): Promise<RetrievalOutcome> {
    if (this.provider.simulated) return { sources: [], performed: false, note: "demo", retriever: null };
    if (!this.retriever.enabled) return { sources: [], performed: false, note: "disabled", retriever: null };

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, this.timeoutMs);
    });
    try {
      const raced = await Promise.race([
        this.retriever.search(req.question, { language: req.language, limit: MAX_SOURCES, signal: controller.signal }),
        timeout,
      ]);
      if (raced === "timeout") return { sources: [], performed: false, note: "timeout", retriever: this.retriever.name };
      const retrievedAt = new Date(this.now()).toISOString();
      const sources = this.prepare(Array.isArray(raced) ? raced : [], retrievedAt, this.retriever.name);
      return sources.length
        ? { sources, performed: true, note: null, retriever: this.retriever.name }
        : { sources: [], performed: true, note: "no_results", retriever: this.retriever.name };
    } catch {
      return { sources: [], performed: false, note: "failed", retriever: this.retriever.name };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Retrieval → provider. Provider errors propagate (mapped to HTTP by the route). */
  async draft(req: KnowledgeQueryRequest): Promise<KnowledgeDraft> {
    const retrieval = await this.retrieve(req);
    const { answer, meta } = await this.provider.answer({ request: req, sources: retrieval.sources });
    return { generated: answer, meta, retrieval };
  }
}
