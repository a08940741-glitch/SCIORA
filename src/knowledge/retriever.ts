import type { RetrievedSource } from "./schemas.ts";

/**
 * Source retrieval abstraction (decision D1: interface only).
 *
 * Phase 2A ships ONLY the NoopRetriever: no real retrieval happens, so every live answer
 * is labelled "not source-verified". A real retriever (e.g. Wikipedia or a web-search tool)
 * is a future decision; tests use a fake retriever that is clearly marked as fake.
 *
 * Anything a retriever returns is UNTRUSTED: it is validated, sanitized, re-identified by the
 * server, and passed to the AI only as quoted data.
 */
export interface SourceRetriever {
  readonly name: string;
  readonly enabled: boolean;
  search(query: string, opts: { language: string; limit: number; signal: AbortSignal }): Promise<RetrievedSource[]>;
}

export class NoopRetriever implements SourceRetriever {
  readonly name = "none";
  readonly enabled = false;
  async search(): Promise<RetrievedSource[]> {
    return [];
  }
}
