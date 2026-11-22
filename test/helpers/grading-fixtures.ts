import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadDemoContent } from "../../src/ai/demo-provider.ts";
import { WrittenJudgement, type SealedExercise } from "../../src/domain/schemas.ts";

/** English-only answer categories (SCIORA is English-only). */
export const CATEGORIES = [
  "english_correct",
  "formal_correct",
  "paraphrase_correct",
  "informal_correct",
  "misspelled_correct",
  "math_equivalent",
  "partial",
  "incorrect",
  "unclear",
  "known_limitation",
] as const;

/** Categories whose answers are CORRECT: grading them "incorrect" is the key safety failure. */
export const CORRECT_CATEGORIES = new Set<string>([
  "english_correct",
  "formal_correct",
  "paraphrase_correct",
  "informal_correct",
  "misspelled_correct",
  "math_equivalent",
]);

const Case = z.strictObject({
  id: z.string(),
  category: z.enum(CATEGORIES),
  exerciseRef: z.string().regex(/^[a-z0-9-]+\/q\d$/),
  reviewedByStudent: z.boolean(),
  answer: z.string().min(1),
  expected: z.enum(["correct", "partially_correct", "incorrect", "uncertain", "unreadable"]),
  recordedJudgement: WrittenJudgement.optional(),
  note: z.string().optional(),
});
export type GradingCase = z.infer<typeof Case>;

const File = z.object({ description: z.string(), cases: z.array(Case).min(30) });

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadGradingCases(): GradingCase[] {
  return File.parse(JSON.parse(readFileSync(join(HERE, "..", "fixtures", "grading-cases.json"), "utf8"))).cases;
}

export function resolveExercise(ref: string): { exercise: SealedExercise; subject: string } {
  const [lessonId, exId] = ref.split("/") as [string, string];
  const file = loadDemoContent().find((f) => f.id === lessonId);
  const exercise = file?.lesson.exercises.find((e) => e.id === exId);
  if (!file || !exercise) throw new Error(`fixture references unknown exercise ${ref}`);
  return { exercise, subject: file.lesson.understood.subject };
}
