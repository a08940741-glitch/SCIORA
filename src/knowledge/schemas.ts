import { z } from "zod";

/**
 * Knowledge Explorer schemas (Phase 2A). Independent of Phase 1 schemas so that
 * Phase 1 behaviour cannot change.
 *
 * SOURCE RULE: the AI's output schema has NO title/URL/publisher fields.
 * The AI may only reference source ids ("S1".."S99") that the SERVER retrieved.
 * Real source metadata comes exclusively from a SourceRetriever.
 */

export const K_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const K_LANGUAGES = ["darija", "msa", "fr", "en"] as const;
export const SEGMENT_KINDS = ["fact", "explanation", "assumption", "uncertainty"] as const;
export const TRANSFORM_MODES = ["simplify", "examples", "quiz"] as const;
export const VERIFICATION_STATUSES = ["source_backed", "not_source_verified", "demo"] as const;

export const KLevel = z.enum(K_LEVELS);
export const KLanguage = z.enum(K_LANGUAGES);
export const SegmentKind = z.enum(SEGMENT_KINDS);
export const TransformMode = z.enum(TRANSFORM_MODES);
export type KLevel = z.infer<typeof KLevel>;
export type KLanguage = z.infer<typeof KLanguage>;
export type SegmentKind = z.infer<typeof SegmentKind>;
export type TransformMode = z.infer<typeof TransformMode>;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

const Text = (max: number) => z.string().min(1).max(max);
export const SourceId = z.string().regex(/^S[1-9][0-9]?$/);

// ------------------------------------------------------------------ requests

export const KnowledgeQueryRequest = z.strictObject({
  question: z.string().trim().min(3).max(1000),
  level: KLevel.default("intermediate"),
  language: KLanguage.default("darija"),
});
export type KnowledgeQueryRequest = z.infer<typeof KnowledgeQueryRequest>;

/** Content sent back by the browser for a transform. UNTRUSTED (user-editable). */
export const TransformContent = z.strictObject({
  topic: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1200),
  points: z.array(z.string().trim().min(1).max(1500)).max(12).default([]),
});

export const TransformRequest = z.strictObject({
  mode: TransformMode,
  level: KLevel.default("intermediate"),
  language: KLanguage.default("darija"),
  content: TransformContent,
});
export type TransformRequest = z.infer<typeof TransformRequest>;

// ------------------------------------------------------------------ AI output: answer

export const GeneratedSegment = z.object({
  kind: SegmentKind,
  text: Text(1500),
  /** Ids of server-retrieved sources supporting this segment. Empty if none. */
  sourceIds: z.array(SourceId).max(5),
});

export const GeneratedConnection = z.object({
  concept: Text(100),
  relation: Text(400),
});

export const GeneratedKnowledgeAnswer = z.object({
  understood: z.object({
    topic: Text(120),
    isEducational: z.boolean(),
    clarification: z.string().max(500).nullable(),
    detectedLanguage: z.enum(["darija", "msa", "fr", "en", "arabizi", "mixed", "other"]),
  }),
  title: Text(160),
  summary: Text(1200),
  segments: z.array(GeneratedSegment).min(1).max(12),
  keyConcepts: z.array(Text(80)).max(8),
  connections: z.array(GeneratedConnection).max(6),
  confidence: z.enum(["high", "medium", "low"]),
  caveats: z.array(Text(400)).max(5),
});
export type GeneratedKnowledgeAnswer = z.infer<typeof GeneratedKnowledgeAnswer>;

// ------------------------------------------------------------------ AI output: transforms

export const SimplifyOutput = z.object({ title: Text(160), text: Text(3000), caveats: z.array(Text(400)).max(3) });
export const ExamplesOutput = z.object({
  title: Text(160),
  examples: z.array(z.object({ title: Text(160), body: Text(1500) })).min(1).max(5),
  caveats: z.array(Text(400)).max(3),
});
export const QuizQuestion = z.object({
  question: Text(500),
  choices: z.array(z.object({ id: z.string().regex(/^[a-d]$/), text: Text(300) })).min(2).max(4),
  correctChoiceId: z.string().regex(/^[a-d]$/),
  explanation: Text(800),
});
export const QuizOutput = z.object({ title: Text(160), questions: z.array(QuizQuestion).min(1).max(5), caveats: z.array(Text(400)).max(3) });
export type SimplifyOutput = z.infer<typeof SimplifyOutput>;
export type ExamplesOutput = z.infer<typeof ExamplesOutput>;
export type QuizOutput = z.infer<typeof QuizOutput>;
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export type TransformOutput =
  | { mode: "simplify"; data: SimplifyOutput }
  | { mode: "examples"; data: ExamplesOutput }
  | { mode: "quiz"; data: QuizOutput };

// ------------------------------------------------------------------ retrieved sources (server-side only)

/** What a SourceRetriever returns. Validated and re-identified by the server. */
export const RetrievedSource = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().url().max(2000),
  publisher: z.string().trim().max(200).nullable(),
  publishedAt: z.string().max(40).nullable(),
  excerpt: z.string().max(20000),
  language: z.string().max(10).nullable(),
});
export type RetrievedSource = z.infer<typeof RetrievedSource>;

/** A source after server-side sanitizing, with a server-assigned id. */
export interface PublicSource {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  excerpt: string;
  language: string | null;
  retriever: string;
}

// ------------------------------------------------------------------ response shapes

export interface KnowledgeMeta {
  source: "anthropic" | "demo";
  simulated: boolean;
  model: string | null;
  fallbackUsed: boolean;
  generatedAt: string;
}

export interface Verification {
  status: VerificationStatus;
  /** True only if a real retriever ran and returned data. */
  retrievalPerformed: boolean;
  retriever: string | null;
  /** Why retrieval did not happen or failed, if relevant. */
  retrievalNote: "disabled" | "failed" | "timeout" | "no_results" | "demo" | null;
  sourcesUsed: number;
  /** Fact segments that are not linked to any retrieved source. */
  uncitedFacts: number;
  /** Citations removed because they did not match a retrieved source. */
  removedCitations: number;
}

export interface PublicSegment {
  kind: SegmentKind;
  text: string;
  sourceIds: string[];
}

export interface KnowledgeQueryResponse {
  answer: {
    understood: GeneratedKnowledgeAnswer["understood"];
    title: string;
    summary: string;
    segments: PublicSegment[];
    keyConcepts: string[];
    confidence: GeneratedKnowledgeAnswer["confidence"];
    caveats: string[];
  };
  sources: PublicSource[];
  verification: Verification;
  /** AI-suggested related concepts. Always suggestions, never established facts. */
  connections: { concept: string; relation: string; suggested: true }[];
  meta: KnowledgeMeta;
  /** System notices (codes translated by the UI). */
  notices: string[];
}

export interface TransformResponse {
  mode: TransformMode;
  result: SimplifyOutput | ExamplesOutput | QuizOutput;
  /** Quizzes are self-check practice: not graded, not recorded, independent of Phase 1 grading. */
  selfCheckOnly: boolean;
  meta: KnowledgeMeta;
  notices: string[];
}
