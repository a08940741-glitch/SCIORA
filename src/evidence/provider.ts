import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { callStructured, type MessagesClient } from "../ai/structured-call.ts";
import { ProviderError } from "../ai/provider.ts";
import { normalizeForMatch } from "../domain/normalize.ts";
import type { NoticeCode } from "../notices.ts";
import type { KnowledgeMeta, PublicSource } from "../knowledge/schemas.ts";
import { EVIDENCE_SYSTEM_PROMPT, evidenceUserMessage } from "./prompts.ts";
import { GeneratedClaimAnalysis, type EvidenceRequest } from "./schemas.ts";

export interface EvidenceProvider {
  readonly name: "anthropic" | "demo";
  readonly simulated: boolean;
  readonly model: string | null;
  analyze(input: { request: EvidenceRequest; sources: PublicSource[] }): Promise<{ analysis: GeneratedClaimAnalysis; meta: KnowledgeMeta; notices?: NoticeCode[] }>;
}

/**
 * Live provider: uses the REASON tier (default Opus 5.5) as planned for evidence analysis.
 * NOT yet exercised against the real API.
 */
export class AnthropicEvidenceProvider implements EvidenceProvider {
  readonly name = "anthropic" as const;
  readonly simulated = false;
  readonly model: string;
  private readonly client: MessagesClient;
  private readonly timeoutMs: number;

  constructor(opts: { client: MessagesClient; model: string; timeoutMs?: number }) {
    this.client = opts.client;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  async analyze(input: { request: EvidenceRequest; sources: PublicSource[] }) {
    const r = await callStructured(this.client, this.timeoutMs, {
      model: this.model,
      effort: "medium",
      system: EVIDENCE_SYSTEM_PROMPT,
      user: evidenceUserMessage(input.request, input.sources),
      format: betaZodOutputFormat(GeneratedClaimAnalysis),
      validate: (v) => GeneratedClaimAnalysis.safeParse(v),
      maxTokens: 16000,
    });
    return { analysis: r.data, meta: { source: "anthropic" as const, simulated: false, model: r.model, fallbackUsed: r.fallbackUsed, generatedAt: new Date().toISOString() } };
  }
}

// ------------------------------------------------------------------ demo

/**
 * DemoEvidenceProvider — pre-written analyses, NO sources and NO evidence items (decision D1).
 * Every factual sub-claim therefore receives "insufficient evidence"; background notes are shown
 * as "not evidence". Content is unreviewed until the project owner checks it.
 */
export const DemoEvidenceFile = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  reviewed: z.boolean(),
  matchKeywords: z.array(z.string().min(2)).min(1),
  analysis: GeneratedClaimAnalysis,
});
export type DemoEvidenceFile = z.infer<typeof DemoEvidenceFile>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DEMO_DIR = join(HERE, "demo-content");

export function loadEvidenceDemo(dir = EVIDENCE_DEMO_DIR): DemoEvidenceFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const p = DemoEvidenceFile.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!p.success) throw new Error(`Invalid evidence demo file ${f}: ${p.error.message}`);
      return p.data;
    });
}

export class DemoEvidenceProvider implements EvidenceProvider {
  readonly name = "demo" as const;
  readonly simulated = true;
  readonly model = null;
  private readonly files: DemoEvidenceFile[];

  constructor(files: DemoEvidenceFile[] = loadEvidenceDemo()) {
    this.files = files;
  }

  claims(): { id: string; claim: string; reviewed: boolean }[] {
    return this.files.map((f) => ({ id: f.id, claim: f.analysis.understood.claimRestated, reviewed: f.reviewed }));
  }

  find(text: string): DemoEvidenceFile | null {
    const q = normalizeForMatch(text);
    let best: { f: DemoEvidenceFile; hits: number } | null = null;
    for (const f of this.files) {
      const hits = f.matchKeywords.filter((k) => q.includes(normalizeForMatch(k))).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { f, hits };
    }
    return best?.f ?? null;
  }

  async analyze(input: { request: EvidenceRequest; sources: PublicSource[] }) {
    const f = this.find(input.request.claim);
    if (!f) throw new ProviderError("not_in_demo", "Demo mode: this claim is not available in the Evidence Analyzer without the AI connection. Try one of the listed demo claims.");
    const notices: NoticeCode[] = ["demo_content"];
    if (input.request.language !== "darija") notices.push("demo_language_fixed");
    if (!f.reviewed) notices.push("content_unreviewed");
    const analysis: GeneratedClaimAnalysis = {
      ...f.analysis,
      subClaims: f.analysis.subClaims.map((s) => ({ ...s, evidence: [] })), // D1: never any evidence in demo
    };
    return { analysis, meta: { source: "demo" as const, simulated: true, model: null, fallbackUsed: false, generatedAt: new Date().toISOString() }, notices };
  }
}
