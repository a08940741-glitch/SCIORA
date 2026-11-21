import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GeneratedLesson, type LessonRequest, type WrittenJudgement } from "../domain/schemas.ts";
import { normalizeAnswer, normalizeForMatch } from "../domain/normalize.ts";
import type { NoticeCode } from "../notices.ts";
import {
  ProviderError,
  type AIProvider,
  type JudgeInput,
  type JudgeOutput,
  type LessonOutput,
} from "./provider.ts";

/**
 * DemoProvider — SIMULATED. Serves a small set of PRE-WRITTEN lessons.
 * It never calls any AI and never generates new content.
 *
 * - Content was drafted with AI assistance during development and is marked
 *   `reviewed: false` until the project owner checks the Darija and the science.
 * - Unknown topics → an explicit "not available in demo mode" error. Never a made-up answer.
 * - Written answers use keyword matching only. A missing keyword yields "unclear"
 *   (→ verdict "uncertain"), NEVER "not_met"/"incorrect", because keywords miss paraphrases.
 */

const DemoKeywords = z.record(z.string(), z.record(z.string(), z.array(z.string().min(2)).min(1)));

/**
 * One demo topic. `lesson` is the Darija/Arabic version (also used by the grading fixtures).
 * `lessonEn` is the English version (default English experience); when present it is fully
 * validated with the same schema and MUST come with `demoKeywordsEn` (checked below).
 */
export const DemoLessonFile = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    reviewed: z.boolean(),
    /** Normalized-substring keywords used to match a student's question to this lesson. */
    matchKeywords: z.array(z.string().min(2)).min(1),
    lesson: GeneratedLesson,
    /** exerciseId → criterionId → keywords (any match = criterion met). */
    demoKeywords: DemoKeywords,
    lessonEn: GeneratedLesson.optional(),
    demoKeywordsEn: DemoKeywords.optional(),
  })
  .superRefine((f, ctx) => {
    if (!!f.lessonEn !== !!f.demoKeywordsEn) {
      ctx.addIssue({ code: "custom", message: "lessonEn and demoKeywordsEn must be provided together" });
    }
  });
export type DemoLessonFile = z.infer<typeof DemoLessonFile>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEMO_CONTENT_DIR = join(HERE, "demo-content");

export function loadDemoContent(dir = DEMO_CONTENT_DIR): DemoLessonFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = DemoLessonFile.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`Invalid demo content file ${f}: ${parsed.error.message}`);
      return parsed.data;
    });
}

export class DemoProvider implements AIProvider {
  readonly name = "demo" as const;
  readonly simulated = true;
  readonly models = null;
  private readonly lessons: DemoLessonFile[];

  constructor(lessons: DemoLessonFile[] = loadDemoContent()) {
    this.lessons = lessons;
  }

  /** Lists available demo topics (shown in the UI so students know what demo mode covers). */
  topics(): { id: string; topic: string; topicEn: string | null; subject: string; reviewed: boolean }[] {
    return this.lessons.map((l) => ({
      id: l.id,
      topic: l.lesson.understood.topic,
      topicEn: l.lessonEn?.understood.topic ?? null,
      subject: l.lesson.understood.subject,
      reviewed: l.reviewed,
    }));
  }

  findLesson(question: string): DemoLessonFile | null {
    const q = normalizeForMatch(question);
    let best: { file: DemoLessonFile; hits: number } | null = null;
    for (const file of this.lessons) {
      const hits = file.matchKeywords.filter((k) => q.includes(normalizeForMatch(k))).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { file, hits };
    }
    return best?.file ?? null;
  }

  async generateLesson(req: LessonRequest): Promise<LessonOutput> {
    const file = this.findLesson(req.question);
    if (!file) {
      throw new ProviderError(
        "not_in_demo",
        "Demo mode: this topic is not available without the AI connection. Try one of the listed demo topics.",
      );
    }
    // English request → English version when available; otherwise the Darija/Arabic version.
    const english = req.language === "en" && !!file.lessonEn;
    const lesson = english ? file.lessonEn! : file.lesson;
    const notices: NoticeCode[] = ["demo_content"];
    if ((req.language === "en" && !english) || req.language === "fr") notices.push("demo_language_fixed");
    if (req.level !== "school") notices.push("demo_level_fixed");
    if (!file.reviewed) notices.push("content_unreviewed");
    return {
      lesson: { ...lesson },
      meta: { source: "demo", simulated: true, model: null, fallbackUsed: false, generatedAt: new Date().toISOString() },
      notices,
    };
  }

  async judgeWritten(input: JudgeInput): Promise<JudgeOutput> {
    const keywordsByCriterion = this.findKeywords(input.exercise.id, input.exercise.prompt);
    const answerNorm = normalizeForMatch(input.answer);
    const criteria: WrittenJudgement["criteria"] = input.exercise.rubric.criteria.map((c) => {
      const kws = keywordsByCriterion?.[c.id] ?? [];
      const hit = kws.find((k) => answerNorm.includes(normalizeForMatch(k)));
      return hit
        ? { criterionId: c.id, judgement: "met" as const, evidence: hit }
        : { criterionId: c.id, judgement: "unclear" as const, evidence: null };
    });
    const allMet = criteria.every((c) => c.judgement === "met");
    const judgement: WrittenJudgement = {
      criteria,
      misconceptionId: null,
      feedback: demoFeedback(input.language === "en" ? "en" : "darija", allMet),
      confidence: "medium",
    };
    return { judgement, source: "demo", simulated: true, model: null, fallbackUsed: false, method: "demo_keywords" };
  }

  /** Keywords for the exercise, from whichever version (Darija or English) contains it. */
  private findKeywords(exerciseId: string, prompt: string): Record<string, string[]> | null {
    const p = normalizeAnswer(prompt);
    for (const file of this.lessons) {
      if (file.lesson.exercises.some((e) => e.id === exerciseId && normalizeAnswer(e.prompt) === p)) return file.demoKeywords[exerciseId] ?? null;
      if (file.lessonEn?.exercises.some((e) => e.id === exerciseId && normalizeAnswer(e.prompt) === p)) return file.demoKeywordsEn?.[exerciseId] ?? null;
    }
    return null;
  }
}

/** Demo keyword-grading feedback in the lesson's language. */
function demoFeedback(language: "en" | "darija", allMet: boolean): string {
  if (language === "en") {
    return allMet
      ? "Demo grading: the key ideas were found in your answer."
      : "Demo grading is limited: it only looks for certain keywords and may miss a correct answer written differently. Compare your answer with the correct answer.";
  }
  return allMet
    ? "تصحيح تجريبي: لقينا الأفكار الأساسية فالجواب ديالك."
    : "التصحيح التجريبي محدود: كيقلب غير على كلمات معينة، وممكن ما يعرفش جواب صحيح مكتوب بطريقة أخرى. قارن الجواب ديالك مع الجواب الصحيح.";
}
