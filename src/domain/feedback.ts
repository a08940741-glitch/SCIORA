import type { Language, SealedExercise, Verdict } from "./schemas.ts";

/** Short fixed feedback for rule-graded answers. SCIORA is English-only. */
const MESSAGES: Record<Language, Record<Exclude<Verdict, "partially_correct">, string>> = {
  en: {
    correct: "Correct! Well done.",
    incorrect: "Not correct this time. Read the explanation to see where the mistake is, then try a new exercise.",
    uncertain: "SCIORA is not sure about the grading of this answer.",
  },
};

export function ruleFeedback(language: Language, verdict: "correct" | "incorrect" | "uncertain"): string {
  return MESSAGES[language][verdict];
}

/** Hint when a numeric/expression answer cannot be parsed (does not consume the attempt). */
export const UNREADABLE_HINT: Record<Language, Record<"numeric" | "expression", string>> = {
  en: {
    numeric: "Your answer could not be read as a number. Write only the number, for example 0.5, 1/2 or 13.",
    expression: "Your expression could not be read. Write it like 2*x + 2 or 2(x+1).",
  },
};

/** The correct answer, revealed only after the (final) graded attempt. */
export function correctAnswerText(ex: SealedExercise): string {
  switch (ex.type) {
    case "mcq":
      return ex.choices.find((c) => c.id === ex.correctChoiceId)?.text ?? ex.correctChoiceId;
    case "numeric":
      return ex.unit ? `${ex.answer} ${ex.unit}` : String(ex.answer);
    case "expression":
      return ex.answer;
    case "short_text":
      return ex.modelAnswer;
  }
}

/** Explanation of WHY a grade is uncertain. */
export function uncertaintyText(_language: Language, unclearRequired: string[]): string {
  if (unclearRequired.length > 0) return `SCIORA could not determine: ${unclearRequired.join("; ")}`;
  return "The automatic grader was not sure about its judgement.";
}
