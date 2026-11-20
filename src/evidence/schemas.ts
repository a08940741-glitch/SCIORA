import { z } from "zod";
import { KLanguage, SourceId, type KnowledgeMeta, type PublicSource, type Verification } from "../knowledge/schemas.ts";

/**
 * Evidence Analyzer schemas (Phase 2B).
 *
 * EVIDENCE RULE: only text quoted from a SERVER-RETRIEVED source can be evidence.
 * The AI output has no URL/title fields; evidence items reference source ids and must
 * quote that source's excerpt (checked by the server). The AI's own knowledge may appear
 * only in `backgroundNote`, which is displayed as "not evidence" and never affects verdicts.
 */

export const CLAIM_TYPES = ["factual", "opinion", "prediction", "value_judgment", "ambiguous"] as const;
export const STANCES = ["supports", "contradicts", "context"] as const;
export const VERDICTS = ["supported", "contradicted", "mixed", "insufficient_evidence", "not_checkable"] as const;

export const ClaimType = z.enum(CLAIM_TYPES);
export const Stance = z.enum(STANCES);
export type ClaimType = z.infer<typeof ClaimType>;
export type Stance = z.infer<typeof Stance>;
export type EvidenceVerdict = (typeof VERDICTS)[number];

const Text = (max: number) => z.string().min(1).max(max);

export const EvidenceRequest = z.strictObject({
  claim: z.string().trim().min(5).max(1000),
  language: KLanguage.default("darija"),
});
export type EvidenceRequest = z.infer<typeof EvidenceRequest>;

export const GeneratedEvidenceItem = z.object({
  sourceId: SourceId,
  stance: Stance,
  /** Exact quote copied from that source's excerpt. Verified by the server. */
  quote: Text(600),
});

export const GeneratedSubClaim = z.object({
  id: z.string().regex(/^c[1-6]$/),
  text: Text(500),
  type: ClaimType,
  evidence: z.array(GeneratedEvidenceItem).max(6),
  /** What evidence would be needed to check this claim. */
  missingEvidence: Text(600),
  /** AI general knowledge. NOT evidence; never used for the verdict. */
  backgroundNote: z.string().max(800).nullable(),
});

export const GeneratedClaimAnalysis = z.object({
  understood: z.object({
    claimRestated: Text(500),
    detectedLanguage: z.enum(["darija", "msa", "fr", "en", "arabizi", "mixed", "other"]),
    isAnalyzable: z.boolean(),
    clarification: z.string().max(500).nullable(),
  }),
  subClaims: z.array(GeneratedSubClaim).min(1).max(6),
  caveats: z.array(Text(400)).max(5),
});
export type GeneratedClaimAnalysis = z.infer<typeof GeneratedClaimAnalysis>;
export type GeneratedSubClaim = z.infer<typeof GeneratedSubClaim>;

// ------------------------------------------------------------------ response

export interface CheckedEvidence {
  sourceId: string;
  stance: Stance;
  quote: string;
}

export interface AnalyzedSubClaim {
  id: string;
  text: string;
  type: ClaimType;
  verdict: EvidenceVerdict;
  evidence: CheckedEvidence[];
  missingEvidence: string;
  backgroundNote: string | null;
}

export interface EvidenceResponse {
  understood: GeneratedClaimAnalysis["understood"];
  overall: { verdict: EvidenceVerdict; checkableSubClaims: number };
  subClaims: AnalyzedSubClaim[];
  sources: PublicSource[];
  basis: {
    /** "retrieved_sources" only when at least one verified evidence item exists. */
    kind: "retrieved_sources" | "none";
    retrievalPerformed: boolean;
    retriever: string | null;
    retrievalNote: Verification["retrievalNote"];
    evidenceItems: number;
    /** Evidence items removed: unknown source id or quote not found in the source. */
    removedEvidence: number;
  };
  caveats: string[];
  meta: KnowledgeMeta;
  /** System notices (codes translated by the UI). */
  notices: string[];
}
