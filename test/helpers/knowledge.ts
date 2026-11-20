import type { GeneratedKnowledgeAnswer, RetrievedSource } from "../../src/knowledge/schemas.ts";

/** AI-style answer used across Knowledge Explorer tests. */
export function sampleKnowledgeAnswer(): GeneratedKnowledgeAnswer {
  return {
    understood: { topic: "التركيب الضوئي", isEducational: true, clarification: null, detectedLanguage: "darija" },
    title: "التركيب الضوئي",
    summary: "النباتات كتصاوب الماكلة ديالها بالضو.",
    segments: [
      { kind: "fact", text: "النباتات الخضرا كتستعمل الضو باش تصاوب السكر.", sourceIds: [] },
      { kind: "explanation", text: "اليخضور كيشد الطاقة ديال الضو.", sourceIds: [] },
      { kind: "uncertainty", text: "التفاصيل الكيميائية معقدة أكثر من هاد الشرح.", sourceIds: [] },
    ],
    keyConcepts: ["اليخضور", "الطاقة الضوئية"],
    connections: [{ concept: "التنفس الخلوي", relation: "عملية كتستعمل السكر اللي تصاوب فالتركيب الضوئي." }],
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
