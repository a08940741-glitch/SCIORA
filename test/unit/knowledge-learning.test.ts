import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTransform, cleanConnections, cleanQuiz } from "../../src/knowledge/learning.ts";
import { KnowledgeService } from "../../src/knowledge/service.ts";
import { DemoKnowledgeProvider } from "../../src/knowledge/demo-provider.ts";
import { ProviderError } from "../../src/ai/provider.ts";
import type { KnowledgeProvider } from "../../src/knowledge/provider.ts";
import type { QuizOutput } from "../../src/knowledge/schemas.ts";
import { sampleKnowledgeAnswer } from "../helpers/knowledge.ts";

const CONTENT = { topic: "Photosynthesis", summary: "Plants make food using light", points: [] as string[] };

test("connections: duplicates, the topic itself and overflow are removed", () => {
  const a = sampleKnowledgeAnswer();
  a.connections = [
    { concept: "Cellular respiration", relation: "r" },
    { concept: "Cellular  RESPIRATION", relation: "duplicate (case and spacing)" },
    { concept: "Photosynthesis", relation: "same as topic" },
    ...["A", "B", "C", "D", "E", "F"].map((x) => ({ concept: `Concept ${x}`, relation: "r" })),
  ];
  const out = cleanConnections(a);
  assert.equal(out.length, 5);
  assert.equal(out.filter((c) => /respiration/i.test(c.concept)).length, 1);
  assert.equal(out.some((c) => c.concept === "Photosynthesis"), false);
});

test("quiz cleaning: questions with a missing correct choice or duplicate ids are dropped", () => {
  const quiz: QuizOutput = {
    title: "t",
    questions: [
      { question: "ok", choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correctChoiceId: "a", explanation: "e" },
      { question: "bad answer", choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correctChoiceId: "c", explanation: "e" },
      { question: "dup ids", choices: [{ id: "a", text: "x" }, { id: "a", text: "y" }], correctChoiceId: "a", explanation: "e" },
    ],
    caveats: [],
  };
  const { quiz: q, dropped } = cleanQuiz(quiz);
  assert.equal(q.questions.length, 1);
  assert.equal(dropped, 2);
  const chk = checkTransform({ mode: "quiz", data: quiz });
  assert.ok(chk.ok && chk.dropped === 2 && chk.output.mode === "quiz" && chk.output.data.questions.length === 1);
});

test("quiz with no valid question → bad_output from the service", async () => {
  const provider: KnowledgeProvider = {
    name: "anthropic",
    simulated: false,
    models: { learn: "a", fast: "b" },
    answer: async () => {
      throw new Error("unused");
    },
    transform: async () => ({
      output: { mode: "quiz", data: { title: "t", questions: [{ question: "q", choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correctChoiceId: "d", explanation: "e" }], caveats: [] } },
      meta: { source: "anthropic", simulated: false, model: "b", fallbackUsed: false, generatedAt: "t" },
    }),
  };
  await assert.rejects(new KnowledgeService({ provider }).transform({ mode: "quiz", level: "beginner", language: "en", content: CONTENT }), (e: unknown) => e instanceof ProviderError && e.code === "bad_output");
});

test("learning mode via service (demo): simplify, examples, quiz; quiz flagged self-check only", async () => {
  const svc = new KnowledgeService({ provider: new DemoKnowledgeProvider() });
  const s = await svc.transform({ mode: "simplify", level: "beginner", language: "en", content: CONTENT });
  assert.equal(s.mode, "simplify");
  assert.equal(s.selfCheckOnly, false);
  const e = await svc.transform({ mode: "examples", level: "beginner", language: "en", content: CONTENT });
  assert.equal(e.mode, "examples");
  const q = await svc.transform({ mode: "quiz", level: "beginner", language: "en", content: CONTENT });
  assert.equal(q.mode, "quiz");
  assert.equal(q.selfCheckOnly, true);
  assert.equal(q.meta.simulated, true);
});

test("learning mode is independent of Phase 1 grading (no token, no exercise set in the response)", async () => {
  const q = await new KnowledgeService({ provider: new DemoKnowledgeProvider() }).transform({ mode: "quiz", level: "beginner", language: "en", content: CONTENT });
  const raw = JSON.stringify(q);
  assert.equal(raw.includes("exerciseSet"), false);
  assert.equal(raw.includes("token"), false);
});

test("demo query returns cleaned suggestions for every topic", async () => {
  const svc = new KnowledgeService({ provider: new DemoKnowledgeProvider() });
  for (const question of ["Photosynthesis", "Pythagoras", "expand", "The principle of inertia", "The water cycle"]) {
    const r = await svc.query({ question, level: "intermediate", language: "en" });
    assert.equal(r.verification.status, "demo");
    assert.ok(r.connections.length >= 1 && r.connections.length <= 5, question);
    assert.ok(r.connections.every((c) => c.suggested));
  }
});
