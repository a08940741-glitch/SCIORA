/**
 * Prompt-injection hygiene for UNTRUSTED text (student questions and answers, retrieved
 * sources, browser-supplied content) before it is embedded between the fixed delimiter tags
 * of a server prompt (<student_question>, <student_answer>, <claim>, <sources>, <content>).
 *
 * - Removes control, zero-width and bidi-override characters (invisible instructions).
 * - Replaces "<" and ">" with look-alike guillemets so the text cannot close or open a tag.
 * - Collapses long runs of blank lines.
 * - Caps the length.
 *
 * The student's ORIGINAL text is still kept for display, rule-based grading and hashing.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

function transform(text: string): string {
  return text.replace(CONTROL, "").replace(/</g, "‹").replace(/>/g, "›").replace(/\n{3,}/g, "\n\n");
}

/** Same transformation as neutralizeForPrompt, without the length cap (used to match quotes). */
export function promptSafeText(text: string): string {
  return transform(text).trim();
}

/** Makes untrusted text safe to embed between our delimiters, capped at maxChars. */
export function neutralizeForPrompt(text: string, maxChars: number): string {
  return transform(text).slice(0, maxChars).trim();
}
