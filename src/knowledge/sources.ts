import { RetrievedSource, type KnowledgeQueryResponse, type PublicSource } from "./schemas.ts";
import type { KnowledgeDraft } from "./service.ts";
import { cleanConnections } from "./learning.ts";

export const MAX_SOURCES = 5;

/**
 * Source transparency (Step 6).
 *
 * sanitizeSources: retrieved content is UNTRUSTED. Only https URLs without credentials,
 *   control/bidi characters removed, lengths capped, duplicates dropped, ids re-assigned
 *   by the server (S1..S5) — a retriever cannot choose ids.
 *
 * finalizeAnswer: the SERVER decides the verification status.
 *   - demo                → "demo" (never verified)
 *   - no retrieved source → "not_source_verified"
 *   - ≥1 segment cites a retrieved source → "source_backed"
 *     ("backed by retrieved sources" — NOT "true" or "proven")
 *   Citations to ids that were not retrieved are removed and counted.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const clean = (s: string, max: number) => s.replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max);

export function isSafeHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function sanitizeSources(raw: unknown[], retrievedAt: string, retriever: string): PublicSource[] {
  const out: PublicSource[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const p = RetrievedSource.safeParse(item);
    if (!p.success || !isSafeHttpsUrl(p.data.url)) continue;
    const url = new URL(p.data.url).toString();
    const key = url.replace(/#.*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    const title = clean(p.data.title, 300);
    const excerpt = clean(p.data.excerpt, 1500);
    if (!title || !excerpt) continue;
    seen.add(key);
    out.push({
      id: `S${out.length + 1}`,
      title,
      url,
      publisher: p.data.publisher ? clean(p.data.publisher, 200) || null : null,
      publishedAt: p.data.publishedAt ? clean(p.data.publishedAt, 40) || null : null,
      retrievedAt,
      excerpt,
      language: p.data.language ? clean(p.data.language, 10) || null : null,
      retriever: clean(retriever, 60),
    });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

export function finalizeAnswer(draft: KnowledgeDraft, simulated: boolean): KnowledgeQueryResponse {
  const { generated, meta, retrieval } = draft;
  const known = new Set(retrieval.sources.map((s) => s.id));
  let removedCitations = 0;

  const segments = generated.segments.map((seg) => {
    const valid = [...new Set(seg.sourceIds)].filter((id) => known.has(id));
    removedCitations += seg.sourceIds.length - valid.length;
    return { kind: seg.kind, text: seg.text, sourceIds: simulated ? [] : valid };
  });

  const cited = new Set(segments.flatMap((s) => s.sourceIds));
  const uncitedFacts = segments.filter((s) => s.kind === "fact" && s.sourceIds.length === 0).length;
  const status = simulated ? "demo" : cited.size > 0 ? "source_backed" : "not_source_verified";

  const notices = [...(draft.notices ?? [])];
  if (removedCitations > 0) notices.push("citations_removed");

  return {
    answer: {
      understood: generated.understood,
      title: generated.title,
      summary: generated.summary,
      segments,
      keyConcepts: generated.keyConcepts,
      confidence: generated.confidence,
      caveats: generated.caveats.slice(0, 5),
    },
    sources: simulated ? [] : retrieval.sources,
    verification: {
      status,
      retrievalPerformed: retrieval.performed,
      retriever: retrieval.retriever,
      retrievalNote: retrieval.note,
      sourcesUsed: cited.size,
      uncitedFacts: simulated ? 0 : uncitedFacts,
      removedCitations,
    },
    connections: cleanConnections(generated).map((c) => ({ concept: c.concept, relation: c.relation, suggested: true as const })),
    meta,
    notices,
  };
}
