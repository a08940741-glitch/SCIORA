import type { Language, SealedExercise, Verdict } from "./schemas.ts";

/** Short fixed feedback for rule-graded answers, in the student's language. */
const MESSAGES: Record<Language, Record<Exclude<Verdict, "partially_correct">, string>> = {
  darija: {
    correct: "جواب صحيح! مزيان، كمل هكا.",
    incorrect: "الجواب ماشي صحيح هاد المرة. قرا الشرح باش تفهم فين كاين الغلط، ومن بعد جرب تمرين جديد.",
    uncertain: "SCIORA ما متأكدش من التصحيح ديال هاد الجواب.",
  },
  msa: {
    correct: "إجابة صحيحة! أحسنت.",
    incorrect: "الإجابة غير صحيحة هذه المرة. اقرأ الشرح لتفهم موضع الخطأ، ثم جرّب تمرينا جديدا.",
    uncertain: "SCIORA غير متأكد من تصحيح هذه الإجابة.",
  },
  fr: {
    correct: "Bonne réponse ! Bravo.",
    incorrect: "La réponse n'est pas correcte cette fois. Lis l'explication pour comprendre l'erreur, puis essaie un nouvel exercice.",
    uncertain: "SCIORA n'est pas sûr de la correction de cette réponse.",
  },
};

export function ruleFeedback(language: Language, verdict: "correct" | "incorrect" | "uncertain"): string {
  return MESSAGES[language][verdict];
}

export const UNREADABLE_HINT: Record<Language, Record<"numeric" | "expression", string>> = {
  darija: {
    numeric: "ما قدرتش نقرا الجواب بحال عدد. كتب غير العدد، مثلا: 0.5 ولا 1/2 ولا 13",
    expression: "ما قدرتش نقرا التعبير. كتبو بحال: 2*x + 2 ولا 2(x+1)",
  },
  msa: {
    numeric: "تعذّرت قراءة الإجابة كعدد. اكتب العدد فقط، مثلا: 0.5 أو 1/2 أو 13",
    expression: "تعذّرت قراءة التعبير. اكتبه مثل: 2*x + 2 أو 2(x+1)",
  },
  fr: {
    numeric: "Je n'ai pas pu lire un nombre. Écris seulement le nombre, par exemple : 0.5 ou 1/2 ou 13",
    expression: "Je n'ai pas pu lire l'expression. Écris-la comme : 2*x + 2 ou 2(x+1)",
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
