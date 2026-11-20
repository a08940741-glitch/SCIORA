/**
 * LIVE smoke test (costs money — owner approval required). Makes 2 real calls:
 * one lesson (LEARN model) and one written-answer grading (FAST model).
 *
 *   SCIORA_ALLOW_LIVE_TESTS=1 SCIORA_AI_MODE=live ANTHROPIC_API_KEY=... npm run test:live
 */
import { requireLiveApproval } from "./live-gate.ts";
import { createProvider } from "../src/ai/index.ts";
import { enforceLessonIntegrity } from "../src/domain/lesson-integrity.ts";
import { aggregate } from "../src/domain/rubric-aggregate.ts";

const config = requireLiveApproval("test:live");
const provider = createProvider(config);

const lessonOut = await provider.generateLesson({ question: "شنو هو التركيب الضوئي؟", level: "school", language: "darija" });
const { lesson, dropped } = enforceLessonIntegrity(lessonOut.lesson);
console.log("lesson meta:", lessonOut.meta);
console.log("topic:", lesson.understood.topic, "| exercises:", lesson.exercises.map((e) => e.type), "| dropped:", dropped);

const st = lesson.exercises.find((e) => e.type === "short_text");
if (st && st.type === "short_text") {
  const answer = "النبتة كتاخد الضو ديال الشمس والما وثاني أكسيد الكربون وكتصاوب السكر";
  const j = await provider.judgeWritten({ exercise: st, answer, language: "darija", subject: lesson.understood.subject, level: "school" }, "fast");
  console.log("grading model:", j.model, "| verdict:", aggregate(st.rubric, j.judgement, answer).verdict);
} else {
  console.log("No short_text exercise generated; grading call skipped.");
}
