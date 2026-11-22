import type { GeneratedLesson } from "../../src/domain/schemas.ts";

/** A complete lesson with all four exercise types. Distinctive answer strings make leak checks reliable. */
export function sampleLesson(): GeneratedLesson {
  return {
    understood: { subject: "life_earth_sciences", topic: "Photosynthesis", isEducational: true, clarification: null },
    explanationSimple: "Plants make their own food using sunlight.",
    explanationFormal: "Plants produce their food through the process of photosynthesis.",
    steps: ["Step 1", "Step 2"],
    example: { problem: "Why is a leaf green?", solution: "Because it contains chlorophyll." },
    exercises: [
      {
        id: "q1",
        type: "mcq",
        prompt: "What does a plant need to make its food?",
        hint: "Think about the Sun.",
        explanation: "EXPLAIN_MCQ_ZETA",
        choices: [
          { id: "a", text: "Light, water and carbon dioxide" },
          { id: "b", text: "Soil only" },
          { id: "c", text: "Salt" },
        ],
        correctChoiceId: "a",
      },
      {
        id: "q2",
        type: "numeric",
        prompt: "What is half of 1?",
        hint: "Divide by 2.",
        explanation: "EXPLAIN_NUM_ZETA",
        answer: 0.5,
        tolerance: 0.01,
        unit: null,
        allowPercent: true,
      },
      {
        id: "q3",
        type: "expression",
        prompt: "Expand 2(x+1)",
        hint: "Multiply each term by 2.",
        explanation: "EXPLAIN_EXPR_ZETA",
        answer: "2*x+2",
        variables: ["x"],
      },
      {
        id: "q4",
        type: "short_text",
        prompt: "How does a plant make its food?",
        hint: "What does the plant need?",
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
