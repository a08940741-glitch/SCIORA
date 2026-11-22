import { normalizeForMatch } from "../domain/normalize.ts";
import type { PublicSource } from "../knowledge/schemas.ts";

/**
 * Relevant passages: sentences from RETRIEVED sources that share key terms with a claim.
 *
 * This is a transparent keyword-overlap heuristic, NOT an evidence judgement:
 * it never affects verdicts and is labelled "keyword match — not evidence" in the UI.
 * It helps students open the source and check the claim themselves.
 * Matching is literal (same language/script); cross-language matches are not attempted.
 */

export interface RelatedPassage {
  sourceId: string;
  passage: string;
  matchedTerms: string[];
}

const STOPWORDS = new Set([
  // English
  "the", "and", "for", "are", "was", "were", "that", "this", "with", "from", "into", "its", "has", "have", "had", "not", "but", "all", "any", "can", "his", "her", "they", "their", "which", "what", "when", "where", "who", "how", "than", "then", "also", "such", "used", "use", "one", "two", "more", "most", "other", "some", "about", "every", "everywhere", "always",
]);

const MIN_SHARED = 2;
const MAX_PASSAGE = 400;

export function keyTerms(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(" ")
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
  );
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

/** Best-matching sentence per source (≥ 2 shared key terms), at most `max` passages overall. */
export function relevantPassages(claim: string, sources: PublicSource[], max = 3): RelatedPassage[] {
  const claimTerms = keyTerms(claim);
  if (claimTerms.size === 0) return [];
  const out: (RelatedPassage & { score: number })[] = [];
  for (const s of sources) {
    let best: (RelatedPassage & { score: number }) | null = null;
    for (const sentence of splitSentences(s.excerpt)) {
      const shared = [...keyTerms(sentence)].filter((t) => claimTerms.has(t));
      if (shared.length >= MIN_SHARED && (!best || shared.length > best.score)) {
        best = { sourceId: s.id, passage: sentence.slice(0, MAX_PASSAGE), matchedTerms: shared.slice(0, 8), score: shared.length };
      }
    }
    if (best) out.push(best);
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ score: _score, ...p }) => p);
}
