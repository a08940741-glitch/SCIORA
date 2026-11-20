/**
 * Answer normalization for comparison ONLY. The student's original text is always kept
 * for display and for the AI grader; normalized text is used for matching and hashing.
 */

const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g; // harakat, superscript alef, Quranic marks
const TATWEEL = /ـ/g;
const ALEF_VARIANTS = /[آأإٱ]/g; // آ أ إ ٱ
const ALEF_MAKSURA = /ى/g; // ى

function mapDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** General normalization: Arabic letters/marks, digits, separators, math symbols, case, spaces. */
export function normalizeAnswer(raw: string): string {
  // Superscript powers must be converted BEFORE NFKC (which would turn "x²" into "x2").
  let s = raw.replace(/\u00B2/g, "^2").replace(/\u00B3/g, "^3").normalize("NFKC");
  s = s.replace(TASHKEEL, "").replace(TATWEEL, "");
  s = s.replace(ALEF_VARIANTS, "ا").replace(ALEF_MAKSURA, "ي");
  s = mapDigits(s);
  s = s
    .replace(/٫/g, ".") // Arabic decimal separator ٫
    .replace(/٬/g, "") // Arabic thousands separator ٬
    .replace(/،/g, ",") // Arabic comma ،
    .replace(/⁄/g, "/") // fraction slash (NFKC of ½ → 1⁄2)
    .replace(/[×✕✖]/g, "*") // ×
    .replace(/÷/g, "/") // ÷
    .replace(/[−‒–—]/g, "-"); // minus / dashes
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  return s;
}

/** Stronger normalization for "is this quote inside the answer?" checks: also drops punctuation. */
export function normalizeForMatch(raw: string): string {
  return normalizeAnswer(raw)
    .replace(/[.,;:!?؛؟"'«»()[\]{}\-_/\\…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
