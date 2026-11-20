import { normalizeForMatch } from "../domain/normalize.ts";
import type { PublicSource } from "../knowledge/schemas.ts";
import type { AnalyzedSubClaim, CheckedEvidence, EvidenceVerdict, GeneratedSubClaim } from "./schemas.ts";

/**
 * Server-side verdict engine (the AI never decides a verdict).
 *
 * 1. Evidence check: an item counts only if its sourceId was retrieved AND its quote
 *    appears in that source's excerpt (after normalization). Otherwise it is removed.
 * 2. Sub-claim verdict:
 *    - opinion / prediction / value_judgment / ambiguous → not_checkable
 *    - no verified supports/contradicts                 → insufficient_evidence
 *    - only supports → supported; only contradicts → contradicted; both → mixed
 *    ("context" items are shown but never decide a verdict)
 * 3. Overall verdict over checkable sub-claims:
 *    - none checkable → not_checkable
 *    - any mixed, or supported and contradicted both present → mixed
 *    - all supported → supported; all contradicted → contradicted
 *    - otherwise (some insufficient) → insufficient_evidence
 */

export function quoteInSource(quote: string, source: PublicSource): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 8) return false; // too short to be meaningful evidence
  return normalizeForMatch(source.excerpt).includes(q);
}

export function checkEvidence(items: GeneratedSubClaim["evidence"], sources: PublicSource[]): { kept: CheckedEvidence[]; removed: number } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const kept: CheckedEvidence[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const src = byId.get(it.sourceId);
    const key = `${it.sourceId}|${it.stance}|${normalizeForMatch(it.quote)}`;
    if (!src || !quoteInSource(it.quote, src) || seen.has(key)) continue;
    seen.add(key);
    kept.push({ sourceId: it.sourceId, stance: it.stance, quote: it.quote });
  }
  return { kept, removed: items.length - kept.length };
}

export function subClaimVerdict(type: GeneratedSubClaim["type"], evidence: CheckedEvidence[]): EvidenceVerdict {
  if (type !== "factual") return "not_checkable";
  const sup = evidence.some((e) => e.stance === "supports");
  const con = evidence.some((e) => e.stance === "contradicts");
  if (sup && con) return "mixed";
  if (sup) return "supported";
  if (con) return "contradicted";
  return "insufficient_evidence";
}

export function overallVerdict(subs: Pick<AnalyzedSubClaim, "verdict">[]): EvidenceVerdict {
  const v = subs.map((s) => s.verdict).filter((x) => x !== "not_checkable");
  if (v.length === 0) return "not_checkable";
  if (v.includes("mixed") || (v.includes("supported") && v.includes("contradicted"))) return "mixed";
  if (v.every((x) => x === "supported")) return "supported";
  if (v.every((x) => x === "contradicted")) return "contradicted";
  return "insufficient_evidence";
}
