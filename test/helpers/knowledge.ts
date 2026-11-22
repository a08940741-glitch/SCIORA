import type { GeneratedKnowledgeAnswer, RetrievedSource } from "../../src/knowledge/schemas.ts";

/** AI-style answer used across Knowledge Explorer tests. */
export function sampleKnowledgeAnswer(): GeneratedKnowledgeAnswer {
  return {
    understood: { topic: "Photosynthesis", isEducational: true, clarification: null, detectedLanguage: "en" },
    title: "Photosynthesis",
    summary: "Plants make their own food using light.",
    segments: [
      { kind: "fact", text: "Green plants use light to make sugar.", sourceIds: [] },
      { kind: "explanation", text: "Chlorophyll captures light energy.", sourceIds: [] },
      { kind: "uncertainty", text: "The chemical details are more complex than this explanation.", sourceIds: [] },
    ],
    keyConcepts: ["Chlorophyll", "Light energy"],
    connections: [{ concept: "Cellular respiration", relation: "A process that uses the sugar made by photosynthesis." }],
    confidence: "medium",
    caveats: [],
  };
}

/** A FAKE retrieved source for tests only. Never used in demo content or production. */
export function fakeSource(overrides: Partial<RetrievedSource> = {}): RetrievedSource {
  return {
    title: "FAKE TEST SOURCE — not a real reference",
    url: "https://example.org/fake-test-source",
    publisher: "Test fixture",
    publishedAt: null,
    excerpt: "Plants use light energy to make sugar from water and carbon dioxide.",
    language: "en",
    ...overrides,
  };
}
