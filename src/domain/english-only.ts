/**
 * SCIORA is an English-only platform. This module provides two deliberately CONSERVATIVE checks:
 *
 *  1. looksNonEnglish(text): flags student input that is CLEARLY not English, so SCIORA can
 *     reply with ENGLISH_ONLY_MESSAGE instead of generating content in that language.
 *  2. findNonEnglishOutput(value): flags AI output that clearly contains non-English prose,
 *     so it can be rejected (and retried once) instead of being shown.
 *
 * Heuristics, not a language detector: they look at writing systems (Arabic, Cyrillic, CJK, …)
 * and at common function words of languages SCIORA previously supported (French, Spanish,
 * Arabizi). They intentionally ACCEPT English that contains scientific terms, Greek symbols
 * (α, π, Δ), proper names, formulas, code, citations or a quoted foreign word. They cannot
 * guarantee perfect English.
 */

export const ENGLISH_ONLY_MESSAGE = "SCIORA currently supports English only. Please submit your question in English to continue.";

const LETTER = /\p{L}/gu;
const LATIN = /\p{Script=Latin}/gu;
const GREEK = /\p{Script=Greek}/gu; // allowed: science and math symbols

/** Counts letters that belong to neither Latin nor Greek scripts (Arabic, Cyrillic, CJK, …). */
function scriptCounts(text: string): { letters: number; foreignScript: number } {
  const letters = text.match(LETTER)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  const greek = text.match(GREEK)?.length ?? 0;
  return { letters, foreignScript: letters - latin - greek };
}

const ENGLISH_WORDS = new Set([
  "the", "is", "are", "was", "were", "be", "been", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "from",
  "what", "why", "how", "which", "who", "when", "where", "does", "do", "did", "can", "could", "should", "would", "will",
  "this", "that", "these", "those", "it", "its", "they", "their", "there", "not", "if", "then", "than", "as", "into", "about",
  "explain", "please", "me", "my", "you", "your", "we", "our", "i", "has", "have", "had", "all", "every", "each", "more",
]);

/** Function words of French, Spanish and Moroccan Arabizi that are not English words. */
const FOREIGN_WORDS = new Set([
  // French
  "le", "la", "les", "des", "une", "est", "sont", "que", "qu", "quoi", "pourquoi", "comment", "quel", "quelle", "dans", "avec",
  "sur", "du", "aux", "cette", "ces", "ce", "il", "elle", "ils", "elles", "nous", "vous", "je", "tu", "pas", "mais", "où", "très",
  "c'est", "suis", "être", "avoir", "fait", "faire", "toujours", "partout",
  // Spanish
  "el", "los", "las", "una", "es", "qué", "cómo", "para", "con", "del", "pero", "muy", "está", "por", "porque", "siempre",
  // Moroccan Arabizi (Darija in Latin letters)
  "chno", "chnou", "chnu", "achno", "howa", "hiya", "wach", "kifach", "3lach", "lach", "dyal", "diyal", "bghit", "kayn", "kayna",
  "mzyan", "f", "fach", "ghadi", "katdor", "kayghli", "3la",
]);

function wordCounts(text: string): { words: number; english: number; foreign: number } {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  let english = 0;
  const foreign = new Set<string>();
  for (const w of words) {
    if (ENGLISH_WORDS.has(w)) english++;
    else if (FOREIGN_WORDS.has(w)) foreign.add(w);
  }
  return { words: words.length, english, foreign: foreign.size };
}

/**
 * True only when the text is CLEARLY not English:
 *  - at least 3 letters and 30% of all letters are in a non-Latin, non-Greek script; or
 *  - at least 3 words, 2+ distinct French/Spanish/Arabizi function words, and no English function word.
 */
export function looksNonEnglish(text: string): boolean {
  const { letters, foreignScript } = scriptCounts(text);
  if (foreignScript >= 3 && foreignScript / Math.max(letters, 1) >= 0.3) return true;
  const w = wordCounts(text);
  return w.words >= 3 && w.foreign >= 2 && w.english === 0;
}

/** Keys whose values are identifiers, codes or external quotes, not AI-written prose. */
const SKIP_KEYS = new Set(["id", "correctChoiceId", "sourceId", "sourceIds", "criterionId", "misconceptionId", "detectedLanguage", "subject", "type", "kind", "stance", "confidence", "judgement", "unit", "variables", "quote", "url"]);

export interface OutputLanguageIssue {
  path: string;
  reason: "non_latin_script" | "foreign_words";
}

/**
 * Walks an AI output object and returns the first clearly non-English prose string, or null.
 * Tolerates a few foreign-script letters (e.g. a quoted name) but not a non-English passage.
 */
export function findNonEnglishOutput(value: unknown, path = "$"): OutputLanguageIssue | null {
  let totalLetters = 0;
  let totalForeign = 0;
  let first: OutputLanguageIssue | null = null;

  const visit = (v: unknown, p: string) => {
    if (first) return;
    if (typeof v === "string") {
      const { letters, foreignScript } = scriptCounts(v);
      totalLetters += letters;
      totalForeign += foreignScript;
      if (foreignScript >= 3 && foreignScript / Math.max(letters, 1) >= 0.2) first = { path: p, reason: "non_latin_script" };
      else {
        const w = wordCounts(v);
        if (w.words >= 6 && w.foreign >= 3 && w.english === 0) first = { path: p, reason: "foreign_words" };
      }
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${p}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP_KEYS.has(k)) visit(x, `${p}.${k}`);
    }
  };
  visit(value, path);
  if (first) return first;
  // Many small foreign-script fragments spread across the output also count as mixed language.
  if (totalForeign > Math.max(10, totalLetters * 0.02)) return { path, reason: "non_latin_script" };
  return null;
}
