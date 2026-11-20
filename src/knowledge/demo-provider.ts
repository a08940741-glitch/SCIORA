import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalizeForMatch } from "../domain/normalize.ts";
import type { NoticeCode } from "../notices.ts";
import { ProviderError, type KnowledgeAnswerInput, type KnowledgeProvider } from "./provider.ts";
import {
  ExamplesOutput,
  GeneratedKnowledgeAnswer,
  QuizOutput,
  SimplifyOutput,
  type KnowledgeMeta,
  type TransformOutput,
  type TransformRequest,
} from "./schemas.ts";

/**
 * DemoKnowledgeProvider — SIMULATED, pre-written content. No AI, no network, no retrieval.
 * Decision D1: demo content contains NO sources and NO citations (every sourceIds is empty),
 * and is always labelled "demo" (never "source-verified"). Content is marked reviewed:false
 * until the project owner checks it.
 */

export const DemoKnowledgeFile = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  reviewed: z.boolean(),
  matchKeywords: z.array(z.string().min(2)).min(1),
  answer: GeneratedKnowledgeAnswer,
  transforms: z.strictObject({ simplify: SimplifyOutput, examples: ExamplesOutput, quiz: QuizOutput }),
});
export type DemoKnowledgeFile = z.infer<typeof DemoKnowledgeFile>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_DEMO_DIR = join(HERE, "demo-content");

export function loadKnowledgeDemo(dir = KNOWLEDGE_DEMO_DIR): DemoKnowledgeFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = DemoKnowledgeFile.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`Invalid knowledge demo file ${f}: ${parsed.error.message}`);
      return parsed.data;
    });
}

const NOT_IN_DEMO = "Demo mode: this topic is not available in the Knowledge Explorer without the AI connection. Try one of the listed demo topics.";

export class DemoKnowledgeProvider implements KnowledgeProvider {
  readonly name = "demo" as const;
  readonly simulated = true;
  readonly models = null;
  private readonly files: DemoKnowledgeFile[];

  constructor(files: DemoKnowledgeFile[] = loadKnowledgeDemo()) {
    this.files = files;
  }

  topics(): { id: string; topic: string; reviewed: boolean }[] {
    return this.files.map((f) => ({ id: f.id, topic: f.answer.understood.topic, reviewed: f.reviewed }));
  }

  private meta(): KnowledgeMeta {
    return { source: "demo", simulated: true, model: null, fallbackUsed: false, generatedAt: new Date().toISOString() };
  }

  find(text: string): DemoKnowledgeFile | null {
    const q = normalizeForMatch(text);
    let best: { f: DemoKnowledgeFile; hits: number } | null = null;
    for (const f of this.files) {
      const hits = f.matchKeywords.filter((k) => q.includes(normalizeForMatch(k))).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { f, hits };
    }
    return best?.f ?? null;
  }

  async answer(input: KnowledgeAnswerInput) {
    const f = this.find(input.request.question);
    if (!f) throw new ProviderError("not_in_demo", NOT_IN_DEMO);
    const notices: NoticeCode[] = ["demo_content"];
    if (input.request.language !== "darija") notices.push("demo_language_fixed");
    if (input.request.level !== "intermediate") notices.push("demo_level_fixed");
    if (!f.reviewed) notices.push("content_unreviewed");
    // D1: strip any source ids defensively (demo content must never carry citations).
    const answer = {
      ...f.answer,
      segments: f.answer.segments.map((s) => ({ ...s, sourceIds: [] })),
    };
    return { answer, meta: this.meta(), notices };
  }

  async transform(req: TransformRequest): Promise<{ output: TransformOutput; meta: KnowledgeMeta; notices: NoticeCode[] }> {
    const f = this.find(`${req.content.topic} ${req.content.summary}`);
    if (!f) throw new ProviderError("not_in_demo", NOT_IN_DEMO);
    const t = f.transforms;
    const output: TransformOutput =
      req.mode === "simplify" ? { mode: "simplify", data: t.simplify } : req.mode === "examples" ? { mode: "examples", data: t.examples } : { mode: "quiz", data: t.quiz };
    const notices: NoticeCode[] = ["demo_content"];
    if (!f.reviewed) notices.push("content_unreviewed");
    return { output, meta: this.meta(), notices };
  }
}
