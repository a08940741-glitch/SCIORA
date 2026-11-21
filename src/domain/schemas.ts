import { z } from "zod";

/**
 * Single source of truth for SCIORA data shapes.
 * The same schemas validate: API requests, AI structured output, and demo content.
 *
 * Two views of an exercise exist:
 *  - SEALED view: includes answer keys / rubrics. Lives only on the server and,
 *    encrypted, inside the exercise token. Never sent to the browser in clear.
 *  - PUBLIC view: prompt, choices, hint. Safe for the browser.
 */

export const LEVELS = ["beginner", "school", "intermediate", "advanced"] as const;
export const LANGUAGES = ["darija", "msa", "fr", "en"] as const;
export const SUBJECTS = ["math", "physics", "life_earth_sciences", "arabic", "french", "general_science"] as const;
export const VERDICTS = ["correct", "partially_correct", "incorrect", "uncertain"] as const;

export const Level = z.enum(LEVELS);
export const Language = z.enum(LANGUAGES);
export const Subject = z.enum(SUBJECTS);
export const Verdict = z.enum(VERDICTS);
export type Level = z.infer<typeof Level>;
export type Language = z.infer<typeof Language>;
export type Subject = z.infer<typeof Subject>;
export type Verdict = z.infer<typeof Verdict>;

const Id = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const Text = (max: number) => z.string().min(1).max(max);

// ---------------------------------------------------------------- requests

export const LessonRequest = z.strictObject({
  question: z.string().trim().min(3).max(1000),
  level: Level.default("school"),
  language: Language.default("darija"),
});
export type LessonRequest = z.infer<typeof LessonRequest>;

export const GradeRequest = z.strictObject({
  token: z.string().min(10).max(24000),
  exerciseId: Id,
  answer: z.string().trim().min(1).max(2000),
});
export type GradeRequest = z.infer<typeof GradeRequest>;

// ---------------------------------------------------------------- sealed exercises (answer keys)

const Common = {
  id: Id,
  prompt: Text(1000),
  hint: Text(500),
  /** Shown only AFTER the graded attempt. */
  explanation: Text(2000),
};

export const McqExercise = z.object({
  ...Common,
  type: z.literal("mcq"),
  choices: z.array(z.object({ id: Id, text: Text(300) })).min(2).max(6),
  correctChoiceId: Id,
});

export const NumericExercise = z.object({
  ...Common,
  type: z.literal("numeric"),
  answer: z.number().finite(),
  tolerance: z.number().min(0),
  unit: z.string().max(20).nullable(),
  allowPercent: z.boolean(),
});

export const ExpressionExercise = z.object({
  ...Common,
  type: z.literal("expression"),
  /** mathjs syntax, e.g. "2*(x+1)". */
  answer: Text(200),
  variables: z.array(z.string().regex(/^[a-z]$/)).min(1).max(3),
});

export const RubricCriterion = z.object({
  id: Id,
  description: Text(300),
  weight: z.number().gt(0).max(10),
  required: z.boolean(),
});

export const Rubric = z.object({
  criteria: z.array(RubricCriterion).min(1).max(6),
  acceptedExamples: z.array(Text(500)).min(1).max(6),
  misconceptions: z.array(z.object({ id: Id, description: Text(300) })).max(6),
  languageSensitive: z.boolean(),
});
export type Rubric = z.infer<typeof Rubric>;

export const ShortTextExercise = z.object({
  ...Common,
  type: z.literal("short_text"),
  rubric: Rubric,
  modelAnswer: Text(1000),
});

export const SealedExercise = z.discriminatedUnion("type", [
  McqExercise,
  NumericExercise,
  ExpressionExercise,
  ShortTextExercise,
]);
export type SealedExercise = z.infer<typeof SealedExercise>;
export type McqExercise = z.infer<typeof McqExercise>;
export type NumericExercise = z.infer<typeof NumericExercise>;
export type ExpressionExercise = z.infer<typeof ExpressionExercise>;
export type ShortTextExercise = z.infer<typeof ShortTextExercise>;

// ---------------------------------------------------------------- generated lesson (AI / demo output)

export const GeneratedLesson = z.object({
  understood: z.object({
    subject: Subject,
    topic: Text(120),
    isEducational: z.boolean(),
    /** Set when the question is unclear or off-topic. */
    clarification: z.string().max(500).nullable(),
  }),
  /** Simple explanation: Moroccan Darija, or plain English when the lesson language is "en". */
  explanationDarija: Text(6000),
  explanationFormal: Text(6000),
  steps: z.array(Text(600)).min(1).max(8),
  example: z.object({ problem: Text(1000), solution: Text(2000) }),
  exercises: z.array(SealedExercise).max(4),
  confidence: z.enum(["high", "medium", "low"]),
  caveats: z.array(Text(400)).max(5),
});
export type GeneratedLesson = z.infer<typeof GeneratedLesson>;

// ---------------------------------------------------------------- AI judgement for written answers

export const CriterionJudgement = z.object({
  criterionId: Id,
  judgement: z.enum(["met", "partial", "not_met", "unclear"]),
  /** Exact quote from the student's answer supporting met/partial. */
  evidence: z.string().max(500).nullable(),
});
export type CriterionJudgement = z.infer<typeof CriterionJudgement>;

export const WrittenJudgement = z.object({
  criteria: z.array(CriterionJudgement).min(1).max(6),
  misconceptionId: z.string().max(32).nullable(),
  feedback: Text(1500),
  confidence: z.enum(["high", "medium", "low"]),
});
export type WrittenJudgement = z.infer<typeof WrittenJudgement>;

// ---------------------------------------------------------------- provenance

export const Meta = z.object({
  source: z.enum(["anthropic", "demo"]),
  simulated: z.boolean(),
  model: z.string().nullable(),
  fallbackUsed: z.boolean(),
  generatedAt: z.string(),
});
export type Meta = z.infer<typeof Meta>;

// ---------------------------------------------------------------- public (browser-safe) views

export type PublicExercise =
  | { id: string; type: "mcq"; prompt: string; hint: string; choices: { id: string; text: string }[] }
  | { id: string; type: "numeric"; prompt: string; hint: string; unit: string | null }
  | { id: string; type: "expression"; prompt: string; hint: string; variables: string[] }
  | { id: string; type: "short_text"; prompt: string; hint: string };

/** Builds the browser view by WHITELISTING fields. Answer keys can never slip through. */
export function toPublicExercise(ex: SealedExercise): PublicExercise {
  switch (ex.type) {
    case "mcq":
      return { id: ex.id, type: ex.type, prompt: ex.prompt, hint: ex.hint, choices: ex.choices.map((c) => ({ id: c.id, text: c.text })) };
    case "numeric":
      return { id: ex.id, type: ex.type, prompt: ex.prompt, hint: ex.hint, unit: ex.unit };
    case "expression":
      return { id: ex.id, type: ex.type, prompt: ex.prompt, hint: ex.hint, variables: [...ex.variables] };
    case "short_text":
      return { id: ex.id, type: ex.type, prompt: ex.prompt, hint: ex.hint };
  }
}

export interface PublicLesson {
  understood: GeneratedLesson["understood"];
  explanationDarija: string;
  explanationFormal: string;
  steps: string[];
  example: GeneratedLesson["example"];
  exercises: PublicExercise[];
  confidence: GeneratedLesson["confidence"];
  caveats: string[];
}

export function toPublicLesson(l: GeneratedLesson): PublicLesson {
  return {
    understood: { ...l.understood },
    explanationDarija: l.explanationDarija,
    explanationFormal: l.explanationFormal,
    steps: [...l.steps],
    example: { ...l.example },
    exercises: l.exercises.map(toPublicExercise),
    confidence: l.confidence,
    caveats: [...l.caveats],
  };
}

/** Field names that must NEVER appear in a browser-bound payload. */
export const FORBIDDEN_PUBLIC_KEYS = [
  "correctChoiceId",
  "answer",
  "tolerance",
  "allowPercent",
  "rubric",
  "criteria",
  "acceptedExamples",
  "misconceptions",
  "modelAnswer",
  "explanation",
] as const;

// ---------------------------------------------------------------- grade result

export interface GradeResult {
  exerciseId: string;
  verdict: Verdict;
  /** 0..1, or null when uncertain. */
  score: number | null;
  method: "deterministic" | "rubric_ai" | "demo_keywords";
  feedback: string;
  criteria: { id: string; description: string; judgement: CriterionJudgement["judgement"]; evidence: string | null }[];
  misconception: string | null;
  uncertaintyReason: string | null;
  /** Revealed only after this (final) graded attempt. */
  correctAnswer: string;
  explanation: string;
  gradedBy: { source: "anthropic" | "demo" | "rules"; simulated: boolean; model: string | null };
  /** Learner model must ignore uncertain results. */
  countsTowardEstimate: boolean;
}
