/**
 * CONTROLLED LIVE AI TEST (real API calls — run only with the project owner's approval).
 * Anthropic calls are billed; Groq calls use the free tier's quota.
 *
 *   SCIORA_ALLOW_LIVE_TESTS=1 SCIORA_AI_MODE=live SCIORA_AI_PROVIDER=groq GROQ_API_KEY=... npm run test:live
 *   SCIORA_ALLOW_LIVE_TESTS=1 SCIORA_AI_MODE=live ANTHROPIC_API_KEY=... npm run test:live   (paid)
 *
 * At most 6 AI calls, made one after another (each may be retried once only for malformed
 * output, so at most 12 HTTP requests), plus free Wikipedia requests if retrieval is enabled:
 *   1. lesson (LEARN)            2. grade a correct written answer (FAST)
 *   3. grade a wrong answer (FAST) 4. knowledge answer (LEARN)
 *   5. simplify transform (FAST) 6. evidence analysis (REASON)
 * Stops at the first provider error. Prints PASS/FAIL per check; never prints keys or prompts.
 * Waits SCIORA_LIVE_TEST_DELAY_MS between calls (default 20000): the first real run on
 * 2026-11-21 hit Groq's free-tier rate limit after 4 back-to-back calls.
 * Exit codes: 0 = all checks passed, 1 = a check failed or a provider error, 2 = refused/config.
 */
import { requireLiveApproval } from "./live-gate.ts";
import { createProvider } from "../src/ai/index.ts";
import { ProviderError } from "../src/ai/provider.ts";
import { enforceLessonIntegrity } from "../src/domain/lesson-integrity.ts";
import { aggregate } from "../src/domain/rubric-aggregate.ts";
import { createKnowledgeProvider } from "../src/knowledge/index.ts";
import { KnowledgeService } from "../src/knowledge/service.ts";
import { createRetriever } from "../src/knowledge/wikipedia-retriever.ts";
import { createEvidenceProvider, EvidenceService } from "../src/evidence/service.ts";
import { checkEvidence, checkGrading, checkKnowledge, checkLesson, summarize, type Check } from "./live-evaluate.ts";

const config = requireLiveApproval("test:live"); // refuses (exit 2) unless all three switches are set
const LANGUAGE = "en" as const;
const delayRaw = Number(process.env.SCIORA_LIVE_TEST_DELAY_MS ?? "20000");
const DELAY_MS = Number.isFinite(delayRaw) ? Math.min(Math.max(Math.trunc(delayRaw), 0), 120_000) : 20_000;
const checks: Check[] = [];
let calls = 0;

function report(): never {
  console.log("");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  [${c.feature}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  const s = summarize(checks);
  console.log(`\n${s.passed} passed, ${s.failed} failed · ${calls} AI call(s) attempted · provider: ${config.aiProvider}`);
  console.log(s.ok ? "RESULT: all checks passed. Review the printed content by hand before calling it verified." : "RESULT: NOT passed.");
  process.exit(s.ok ? 0 : 1);
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (calls > 0 && DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS)); // free-tier friendly pacing
  calls++;
  console.log(`→ ${label}…`);
  try {
    return await fn();
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : "unexpected_error";
    const message = err instanceof ProviderError ? err.message : "An unexpected error occurred.";
    checks.push({ feature: label, name: "AI call completed", pass: false, detail: `${code}: ${message}` });
    report();
  }
}

const provider = createProvider(config);
const retriever = createRetriever(config);

// 1–3. Learning Assistant: lesson + grading (a correct and a wrong written answer).
const lessonOut = await step("lesson", () => provider.generateLesson({ question: "Explain the Pythagorean theorem", level: "school", language: LANGUAGE }));
const { lesson, dropped } = enforceLessonIntegrity(lessonOut.lesson);
checks.push(...checkLesson({ lesson, meta: lessonOut.meta }, dropped, LANGUAGE));
console.log(`   topic: ${lesson.understood.topic} | exercises: ${lesson.exercises.map((e) => e.type).join(", ")}`);

const written = lesson.exercises.find((e) => e.type === "short_text");
if (written && written.type === "short_text") {
  const input = { exercise: written, language: LANGUAGE, subject: lesson.understood.subject, level: "school" as const };
  const good = written.modelAnswer;
  const wrong = "I don't know. Maybe it is about circles.";
  const g = await step("grade correct answer", () => provider.judgeWritten({ ...input, answer: good }, "fast"));
  const w = await step("grade wrong answer", () => provider.judgeWritten({ ...input, answer: wrong }, "fast"));
  checks.push(...checkGrading(aggregate(written.rubric, g.judgement, good).verdict, aggregate(written.rubric, w.judgement, wrong).verdict, g.model));
} else {
  checks.push({ feature: "Written-answer grading", name: "a written exercise was generated to grade", pass: false });
}

// 4–5. Knowledge Explorer: answer (with real retrieval if enabled) + a learning-mode transform.
const knowledge = new KnowledgeService({ provider: createKnowledgeProvider(config), retriever });
const k = await step("knowledge answer", () => knowledge.query({ question: "What is photosynthesis?", level: "intermediate", language: LANGUAGE }));
checks.push(...checkKnowledge(k, LANGUAGE));
console.log(`   status: ${k.verification.status} | sources: ${k.sources.length} | removed citations: ${k.verification.removedCitations}`);
const t = await step("simplify transform", () => knowledge.transform({ mode: "simplify", level: "intermediate", language: LANGUAGE, content: { topic: k.answer.title, summary: k.answer.summary, points: [] } }));
checks.push({ feature: "Knowledge Explorer", name: "simplify transform returned a valid result", pass: t.mode === "simplify" });

// 6. Evidence Analyzer.
const evidence = new EvidenceService({ provider: createEvidenceProvider(config), retriever });
const e = await step("evidence analysis", () => evidence.analyze({ claim: "Water always boils at 100 degrees Celsius everywhere", language: LANGUAGE }));
checks.push(...checkEvidence(e));
console.log(`   overall: ${e.overall.verdict} | sub-claims: ${e.subClaims.map((s) => `${s.type}:${s.verdict}`).join(", ")}`);

report();
