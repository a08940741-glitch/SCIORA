import type { GeneratedLesson, Language, Meta } from "../src/domain/schemas.ts";
import type { KnowledgeMeta, KnowledgeQueryResponse } from "../src/knowledge/schemas.ts";
import type { EvidenceResponse } from "../src/evidence/schemas.ts";
import { VERDICTS } from "../src/evidence/schemas.ts";
import { normalizeForMatch } from "../src/domain/normalize.ts";
import { findNonEnglishOutput } from "../src/domain/english-only.ts";

/**
 * Pure pass/fail checks for the controlled live AI test (scripts/live-smoke.ts).
 * They only inspect outputs SCIORA already validated; they never call a provider.
 * Unit-tested with fake outputs (test/unit/live-evaluate.test.ts).
 */
export interface Check {
  feature: string;
  name: string;
  pass: boolean;
  detail?: string;
}


function isLive(meta: Meta | KnowledgeMeta): boolean {
  return meta.simulated === false && meta.source !== "demo" && typeof meta.model === "string" && meta.model.length > 0;
}

export function checkLesson(out: { lesson: GeneratedLesson; meta: Meta }, dropped: string[], language: Language): Check[] {
  const f = "Learning Assistant";
  const ex = out.lesson.exercises;
  const checks: Check[] = [
    { feature: f, name: "served by a live provider (not demo)", pass: isLive(out.meta), detail: `${out.meta.source} / ${out.meta.model}` },
    { feature: f, name: "question understood as educational", pass: out.lesson.understood.isEducational === true },
    { feature: f, name: "3 exercises after SCIORA's integrity check", pass: ex.length === 3, detail: `${ex.length} kept, ${dropped.length} dropped` },
    { feature: f, name: "includes a written (short_text) exercise with a rubric", pass: ex.some((e) => e.type === "short_text") },
    { feature: f, name: "no exercise dropped as broken", pass: dropped.length === 0, detail: dropped.join("; ") || undefined },
  ];
  void language;
  checks.push({ feature: f, name: "lesson is in English (no clearly non-English text)", pass: findNonEnglishOutput(out.lesson) === null });
  return checks;
}

/** A correct answer must not be marked incorrect; a wrong answer must never be marked correct. */
export function checkGrading(goodVerdict: string, wrongVerdict: string, model: string | null): Check[] {
  const f = "Written-answer grading";
  return [
    { feature: f, name: "graded by a live model", pass: typeof model === "string" && model.length > 0, detail: model ?? undefined },
    { feature: f, name: "correct answer is not marked incorrect", pass: goodVerdict !== "incorrect", detail: goodVerdict },
    { feature: f, name: "wrong answer is NOT marked correct", pass: wrongVerdict !== "correct", detail: wrongVerdict },
  ];
}

export function checkKnowledge(r: KnowledgeQueryResponse, language: Language): Check[] {
  const f = "Knowledge Explorer";
  const known = new Set(r.sources.map((s) => s.id));
  const cited = r.answer.segments.flatMap((s) => s.sourceIds);
  const checks: Check[] = [
    { feature: f, name: "served by a live provider (not demo)", pass: isLive(r.meta), detail: `${r.meta.source} / ${r.meta.model}` },
    { feature: f, name: "verification status is a live status", pass: r.verification.status === "not_source_verified" || r.verification.status === "source_backed", detail: r.verification.status },
    { feature: f, name: "every cited source was really retrieved", pass: cited.every((id) => known.has(id)), detail: `${cited.length} citation(s), ${r.sources.length} source(s), ${r.verification.removedCitations} removed` },
    { feature: f, name: "'source_backed' only when a source is cited", pass: r.verification.status !== "source_backed" || cited.length > 0 },
    { feature: f, name: "answer has labelled segments", pass: r.answer.segments.length > 0 },
  ];
  void language;
  checks.push({ feature: f, name: "answer is in English (no clearly non-English text)", pass: findNonEnglishOutput(r.answer) === null });
  return checks;
}

export function checkEvidence(r: EvidenceResponse): Check[] {
  const f = "Evidence Analyzer";
  const byId = new Map(r.sources.map((s) => [s.id, s]));
  const items = r.subClaims.flatMap((s) => s.evidence);
  const quotesVerified = items.every((e) => {
    const src = byId.get(e.sourceId);
    return !!src && normalizeForMatch(src.excerpt).includes(normalizeForMatch(e.quote));
  });
  return [
    { feature: f, name: "served by a live provider (not demo)", pass: isLive(r.meta), detail: `${r.meta.source} / ${r.meta.model}` },
    { feature: f, name: "claim split into at least one sub-claim", pass: r.subClaims.length > 0, detail: `${r.subClaims.length} sub-claim(s)` },
    { feature: f, name: "every evidence quote appears in its retrieved source", pass: quotesVerified, detail: `${items.length} evidence item(s), ${r.basis.removedEvidence} removed by the server` },
    { feature: f, name: "no evidence without retrieved sources", pass: r.sources.length > 0 || items.length === 0 },
    { feature: f, name: "overall verdict is a known verdict", pass: (VERDICTS as readonly string[]).includes(r.overall.verdict), detail: r.overall.verdict },
    { feature: f, name: "analysis is in English (no clearly non-English text)", pass: findNonEnglishOutput({ understood: r.understood, subClaims: r.subClaims.map((s) => ({ text: s.text, missingEvidence: s.missingEvidence, backgroundNote: s.backgroundNote })) }) === null },
  ];
}

export function summarize(checks: Check[]): { passed: number; failed: number; ok: boolean } {
  const failed = checks.filter((c) => !c.pass).length;
  return { passed: checks.length - failed, failed, ok: failed === 0 };
}
