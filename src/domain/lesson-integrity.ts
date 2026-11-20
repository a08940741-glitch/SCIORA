import type { GeneratedLesson, SealedExercise } from "./schemas.ts";
import { compareExpressions } from "./grading.ts";

/**
 * Checks things a JSON schema cannot: unique ids, the correct MCQ choice exists,
 * expression references are parseable, rubric criterion ids are unique.
 * Invalid exercises are DROPPED (with a caveat) rather than shown broken.
 */
export function checkExercise(ex: SealedExercise): string | null {
  switch (ex.type) {
    case "mcq": {
      const ids = ex.choices.map((c) => c.id);
      if (new Set(ids).size !== ids.length) return "duplicate choice ids";
      if (!ids.includes(ex.correctChoiceId)) return "correct choice not among choices";
      return null;
    }
    case "numeric":
      return Number.isFinite(ex.answer) && ex.tolerance >= 0 ? null : "invalid numeric key";
    case "expression":
      return compareExpressions(ex.answer, ex.answer, ex.variables) === "equivalent" ? null : "reference expression not parseable";
    case "short_text": {
      const ids = ex.rubric.criteria.map((c) => c.id);
      if (new Set(ids).size !== ids.length) return "duplicate criterion ids";
      return null;
    }
  }
}

export function enforceLessonIntegrity(lesson: GeneratedLesson): { lesson: GeneratedLesson; dropped: string[] } {
  const seen = new Set<string>();
  const kept: SealedExercise[] = [];
  const dropped: string[] = [];
  for (const ex of lesson.exercises) {
    const problem = seen.has(ex.id) ? "duplicate exercise id" : checkExercise(ex);
    if (problem) dropped.push(`${ex.id}: ${problem}`);
    else {
      kept.push(ex);
      seen.add(ex.id);
    }
  }
  // The UI shows an "exercises_removed" notice when `dropped` is not empty.
  return { lesson: { ...lesson, exercises: kept }, dropped };
}
