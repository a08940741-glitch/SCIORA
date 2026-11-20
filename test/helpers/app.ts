import { Writable } from "node:stream";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import type { AIProvider, JudgeInput, JudgeOutput, LessonOutput, ModelTier } from "../../src/ai/provider.ts";
import type { LessonRequest, WrittenJudgement } from "../../src/domain/schemas.ts";
import type { KnowledgeProvider } from "../../src/knowledge/provider.ts";
import type { SourceRetriever } from "../../src/knowledge/retriever.ts";
import type { EvidenceProvider } from "../../src/evidence/provider.ts";
import { sampleLesson } from "./sample-lesson.ts";

export const TEST_SECRET_B64 = Buffer.alloc(32, 9).toString("base64");

export function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    SCIORA_TOKEN_SECRET: TEST_SECRET_B64,
    SCIORA_RATE_LIMIT_PER_MINUTE: "10000",
    ...env,
  });
}

export async function makeApp(
  opts: { provider?: AIProvider; knowledgeProvider?: KnowledgeProvider; evidenceProvider?: EvidenceProvider; retriever?: SourceRetriever; env?: Record<string, string>; now?: () => number; logLevel?: string } = {},
) {
  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(chunk.toString());
      cb();
    },
  });
  const { app, replay } = await buildApp({
    config: testConfig(opts.env),
    provider: opts.provider ?? new DemoProvider(),
    knowledgeProvider: opts.knowledgeProvider,
    evidenceProvider: opts.evidenceProvider,
    retriever: opts.retriever,
    now: opts.now,
    logStream,
    logLevel: opts.logLevel,
  });
  await app.ready();
  return { app, replay, logs };
}

/**
 * Stub provider that behaves like a LIVE provider (simulated=false) without any network.
 * Lesson = sampleLesson(); judging is scripted per test.
 */
export class StubLiveProvider implements AIProvider {
  readonly name = "anthropic" as const;
  readonly simulated = false;
  readonly models = { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" };
  judgeCalls: { input: JudgeInput; tier: ModelTier }[] = [];
  lessonCalls = 0;
  constructor(
    public judgeImpl: (input: JudgeInput, tier: ModelTier) => Promise<WrittenJudgement> = async () => allMet(),
    public lessonImpl: (req: LessonRequest) => Promise<LessonOutput> = async () => ({
      lesson: sampleLesson(),
      meta: { source: "anthropic", simulated: false, model: "claude-sonnet-5-5", fallbackUsed: false, generatedAt: new Date(0).toISOString() },
    }),
  ) {}
  async generateLesson(req: LessonRequest): Promise<LessonOutput> {
    this.lessonCalls++;
    return this.lessonImpl(req);
  }
  async judgeWritten(input: JudgeInput, tier: ModelTier): Promise<JudgeOutput> {
    this.judgeCalls.push({ input, tier });
    const judgement = await this.judgeImpl(input, tier);
    return { judgement, source: "anthropic", simulated: false, model: this.models[tier], fallbackUsed: false, method: "rubric_ai" };
  }
}

/** Judgement for the sample short_text exercise (q4) with evidence taken from STUDENT_ANSWER. */
export const STUDENT_ANSWER = "النبتة كتستعمل الضو ديال الشمس باش تحول الما وثاني أكسيد الكربون لسكر";
export function allMet(): WrittenJudgement {
  return {
    criteria: [
      { criterionId: "light", judgement: "met", evidence: "الضو ديال الشمس" },
      { criterionId: "inputs", judgement: "met", evidence: "الما وثاني أكسيد الكربون" },
    ],
    misconceptionId: null,
    feedback: "مزيان",
    confidence: "high",
  };
}
export function unclear(): WrittenJudgement {
  return {
    criteria: [
      { criterionId: "light", judgement: "unclear", evidence: null },
      { criterionId: "inputs", judgement: "met", evidence: "الما" },
    ],
    misconceptionId: null,
    feedback: "ما متأكدش",
    confidence: "medium",
  };
}

export async function learn(app: Awaited<ReturnType<typeof makeApp>>["app"], question = "شنو هو التركيب الضوئي؟") {
  const res = await app.inject({ method: "POST", url: "/api/learn", payload: { question } });
  return { res, body: res.json() as any };
}

export async function grade(app: Awaited<ReturnType<typeof makeApp>>["app"], token: string, exerciseId: string, answer: string) {
  const res = await app.inject({ method: "POST", url: "/api/grade", payload: { token, exerciseId, answer } });
  return { res, body: res.json() as any };
}
