import { normalizeForMatch } from "../domain/normalize.ts";
import type { GeneratedKnowledgeAnswer, QuizOutput, TransformOutput } from "./schemas.ts";

/**
 * Topic connections and learning mode helpers (Step 8).
 * Independent of the Phase 1 grading engine: no tokens, no replay store, no level estimate.
 */

export const MAX_CONNECTIONS = 5;

/** Dedupes connections, removes the topic itself, caps the list. Always suggestions. */
export function cleanConnections(answer: GeneratedKnowledgeAnswer): GeneratedKnowledgeAnswer["connections"] {
  const topic = normalizeForMatch(answer.understood.topic);
  const title = normalizeForMatch(answer.title);
  const seen = new Set<string>();
  const out: GeneratedKnowledgeAnswer["connections"] = [];
  for (const c of answer.connections) {
    const key = normalizeForMatch(c.concept);
    if (!key || key === topic || key === title || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CONNECTIONS) break;
  }
  return out;
}

/** Keeps only well-formed quiz questions (unique choice ids, correct choice present). */
export function cleanQuiz(quiz: QuizOutput): { quiz: QuizOutput; dropped: number } {
  const questions = quiz.questions.filter((q) => {
    const ids = q.choices.map((c) => c.id);
    return new Set(ids).size === ids.length && ids.includes(q.correctChoiceId);
  });
  return { quiz: { ...quiz, questions }, dropped: quiz.questions.length - questions.length };
}

export function checkTransform(out: TransformOutput): { ok: true; output: TransformOutput; dropped: number } | { ok: false } {
  if (out.mode !== "quiz") return { ok: true, output: out, dropped: 0 };
  const { quiz, dropped } = cleanQuiz(out.data);
  if (quiz.questions.length === 0) return { ok: false };
  const caveats = dropped > 0 ? [...quiz.caveats, "تحيدو بعض الأسئلة حيت ما دازوش الفحص الأوتوماتيكي."].slice(0, 3) : quiz.caveats;
  return { ok: true, output: { mode: "quiz", data: { ...quiz, caveats } }, dropped };
}
