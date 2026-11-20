import type { GeneratedLesson } from "../../src/domain/schemas.ts";

/** A complete lesson with all four exercise types. Distinctive answer strings make leak checks reliable. */
export function sampleLesson(): GeneratedLesson {
  return {
    understood: { subject: "life_earth_sciences", topic: "التركيب الضوئي", isEducational: true, clarification: null },
    explanationDarija: "النباتات كتصاوب الماكلة ديالها بالضو ديال الشمس.",
    explanationFormal: "تصنع النباتات غذاءها عبر عملية التركيب الضوئي.",
    steps: ["الخطوة 1", "الخطوة 2"],
    example: { problem: "علاش الورقة خضرا؟", solution: "حيت فيها اليخضور." },
    exercises: [
      {
        id: "q1",
        type: "mcq",
        prompt: "شنو كيحتاج النبات باش يصاوب الماكلة؟",
        hint: "فكر فالشمس",
        explanation: "EXPLAIN_MCQ_ZETA",
        choices: [
          { id: "a", text: "الضو والما وثاني أكسيد الكربون" },
          { id: "b", text: "التراب بوحدو" },
          { id: "c", text: "الملح" },
        ],
        correctChoiceId: "a",
      },
      {
        id: "q2",
        type: "numeric",
        prompt: "شحال هو نص ديال 1؟",
        hint: "قسم على 2",
        explanation: "EXPLAIN_NUM_ZETA",
        answer: 0.5,
        tolerance: 0.01,
        unit: null,
        allowPercent: true,
      },
      {
        id: "q3",
        type: "expression",
        prompt: "نشر 2(x+1)",
        hint: "ضرب 2 فكل حد",
        explanation: "EXPLAIN_EXPR_ZETA",
        answer: "2*x+2",
        variables: ["x"],
      },
      {
        id: "q4",
        type: "short_text",
        prompt: "كيفاش كيصاوب النبات الماكلة ديالو؟",
        hint: "شنو كيحتاج النبات؟",
        explanation: "EXPLAIN_TEXT_ZETA",
        rubric: {
          criteria: [
            { id: "light", description: "RUBRIC_LIGHT_ZETA: mentions sunlight as energy source", weight: 1, required: true },
            { id: "inputs", description: "RUBRIC_INPUTS_ZETA: mentions water and carbon dioxide", weight: 1, required: true },
          ],
          acceptedExamples: ["ACCEPTED_EXAMPLE_ZETA"],
          misconceptions: [{ id: "soil_food", description: "MISCONCEPTION_ZETA: plants eat soil" }],
          languageSensitive: false,
        },
        modelAnswer: "MODEL_ANSWER_ZETA",
      },
    ],
    confidence: "high",
    caveats: [],
  };
}

/** Strings that exist ONLY in sealed fields. None may appear in a browser-bound payload. */
export const SECRET_MARKERS = [
  "EXPLAIN_MCQ_ZETA",
  "EXPLAIN_NUM_ZETA",
  "EXPLAIN_EXPR_ZETA",
  "EXPLAIN_TEXT_ZETA",
  "RUBRIC_LIGHT_ZETA",
  "RUBRIC_INPUTS_ZETA",
  "ACCEPTED_EXAMPLE_ZETA",
  "MISCONCEPTION_ZETA",
  "MODEL_ANSWER_ZETA",
  "2*x+2",
];
