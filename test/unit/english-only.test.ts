import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGLISH_ONLY_MESSAGE, findNonEnglishOutput, looksNonEnglish } from "../../src/domain/english-only.ts";
import { ENGLISH_ONLY_RULE, JUDGE_SYSTEM_PROMPT, LESSON_SYSTEM_PROMPT } from "../../src/ai/prompts.ts";
import { KNOWLEDGE_SYSTEM_PROMPT, transformSystemPrompt } from "../../src/knowledge/prompts.ts";
import { EVIDENCE_SYSTEM_PROMPT } from "../../src/evidence/prompts.ts";
import { callGroqStructured } from "../../src/ai/groq-client.ts";
import { callStructured } from "../../src/ai/structured-call.ts";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ProviderError } from "../../src/ai/provider.ts";
import { WrittenJudgement } from "../../src/domain/schemas.ts";
import { fakeGroqClient, groqOk } from "../helpers/fake-groq.ts";
import { fakeClient, okResponse } from "../helpers/fake-client.ts";
import { allMet } from "../helpers/app.ts";

// ---------------------------------------------------------------- input detection

test("the English-only notice is the exact required sentence", () => {
  assert.equal(ENGLISH_ONLY_MESSAGE, "SCIORA currently supports English only. Please submit your question in English to continue.");
});

test("clearly non-English input is detected (Arabic, Darija in Arabizi, French, Spanish, Russian, Chinese)", () => {
  for (const s of ["شنو هو التركيب الضوئي؟", "chno howa tarkib daw2i", "Qu'est-ce que la photosynthèse ?", "Pourquoi le ciel est bleu", "¿Qué es la fotosíntesis?", "Что такое фотосинтез?", "光合作用是什么"]) {
    assert.equal(looksNonEnglish(s), true, s);
  }
});

test("valid English is NOT rejected: loanwords, names, Greek symbols, formulas, code, a quoted foreign word", () => {
  for (const s of [
    "What is photosynthesis?",
    "photosynthesis",
    "Expand 2(x + 3) - x",
    "x = 5",
    "What is déjà vu in psychology?",
    "Why does El Niño affect rainfall?",
    "Explain Δv = a·t and why π ≈ 3.14",
    "What does the Arabic word علم mean in science history?",
    "Who was Ibn al-Haytham?",
    'Explain console.log("hi") in JavaScript',
    "The café and the résumé",
    "Is it true that pour water faster boils?",
    "13 cm",
  ]) {
    assert.equal(looksNonEnglish(s), false, s);
  }
});

// ---------------------------------------------------------------- output validation

test("AI output validation: non-English or mixed-language prose is found; English with a quoted name is accepted", () => {
  assert.equal(findNonEnglishOutput({ title: "Photosynthesis", summary: "Plants make food." }), null);
  assert.equal(findNonEnglishOutput({ text: "The Arabic word علم means knowledge." }), null, "a short quoted word is tolerated");
  assert.deepEqual(findNonEnglishOutput({ title: "Photosynthesis", summary: "النباتات كتصاوب الماكلة" }), { path: "$.summary", reason: "non_latin_script" });
  assert.equal(findNonEnglishOutput({ text: "La photosynthèse est le processus par lequel les plantes fabriquent leur nourriture" })?.reason, "foreign_words");
  assert.equal(findNonEnglishOutput({ steps: ["Step one in English.", "Шаг два на русском языке"] })?.path, "$.steps[1]");
});

test("AI output validation skips ids and quotes copied from sources (external content)", () => {
  assert.equal(findNonEnglishOutput({ evidence: [{ sourceId: "S1", quote: "東京は日本の首都です" }], text: "Tokyo is the capital of Japan." }), null);
});

// ---------------------------------------------------------------- prompts

test("every AI system prompt carries the explicit English-only rule and no multilingual instructions", () => {
  const prompts = {
    lesson: LESSON_SYSTEM_PROMPT,
    judge: JUDGE_SYSTEM_PROMPT,
    knowledge: KNOWLEDGE_SYSTEM_PROMPT,
    simplify: transformSystemPrompt("simplify"),
    examples: transformSystemPrompt("examples"),
    quiz: transformSystemPrompt("quiz"),
    evidence: EVIDENCE_SYSTEM_PROMPT,
  };
  assert.match(ENGLISH_ONLY_RULE, /never switch language/);
  for (const [name, p] of Object.entries(prompts)) {
    assert.ok(p.includes(ENGLISH_ONLY_RULE), `${name}: English-only rule`);
    assert.doesNotMatch(p, /Darija|Arabizi|Modern Standard Arabic|French|Moroccan|"msa"|"fr"/, `${name}: no multilingual instructions`);
    assert.equal(/[؀-ۿ]/.test(p), false, `${name}: no Arabic script`);
  }
  assert.match(LESSON_SYSTEM_PROMPT, /"explanationSimple"/);
});

// ---------------------------------------------------------------- live paths reject non-English output

const FRENCH_JUDGEMENT = { ...allMet(), feedback: "Très bien, la réponse est correcte et les idées sont présentes dans le texte" };
const ARABIC_JUDGEMENT = { ...allMet(), feedback: "جواب مزيان، كمل هكا" };

test("Groq: non-English output is retried once, then rejected with an English error (bounded at 2 requests)", async () => {
  const { client, calls } = fakeGroqClient([groqOk(ARABIC_JUDGEMENT), groqOk(FRENCH_JUDGEMENT), groqOk(allMet())]);
  await assert.rejects(
    callGroqStructured(client, 5_000, { model: "openai/gpt-oss-120b", effort: "low", system: "S", user: "U", schemaName: "j", schema: WrittenJudgement, maxTokens: 100 }),
    (e: unknown) => e instanceof ProviderError && e.code === "bad_output" && e.message === "The AI response was not in English.",
  );
  assert.equal(calls.length, 2);
});

test("Groq: if the retry is English, the English result is used", async () => {
  const { client, calls } = fakeGroqClient([groqOk(ARABIC_JUDGEMENT), groqOk(allMet())]);
  const r = await callGroqStructured(client, 5_000, { model: "openai/gpt-oss-120b", effort: "low", system: "S", user: "U", schemaName: "j", schema: WrittenJudgement, maxTokens: 100 });
  assert.equal(r.data.feedback, allMet().feedback);
  assert.equal(calls.length, 2);
});

test("Anthropic path: non-English output is retried once, then rejected with the same English error", async () => {
  const args = { model: "claude-haiku-5-5", effort: "low" as const, system: "S", user: "U", format: betaZodOutputFormat(WrittenJudgement), validate: (v: unknown) => WrittenJudgement.safeParse(v) as any, maxTokens: 100 };
  const bad = fakeClient([okResponse(ARABIC_JUDGEMENT, "claude-haiku-5-5"), okResponse(FRENCH_JUDGEMENT, "claude-haiku-5-5")]);
  await assert.rejects(callStructured(bad.client, 5_000, args), (e: unknown) => e instanceof ProviderError && e.message === "The AI response was not in English.");
  assert.equal(bad.calls.length, 2);
  const ok = fakeClient([okResponse(allMet(), "claude-haiku-5-5")]);
  assert.equal(((await callStructured(ok.client, 5_000, args)).data as any).feedback, allMet().feedback);
  assert.equal(ok.calls.length, 1);
});
