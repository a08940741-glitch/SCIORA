import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { testConfig } from "../helpers/app.ts";

/** End-to-end workflows (demo mode, no network). */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let browser: any;
let app: any;
let base = "";
before(async () => {
  ({ app } = await buildApp({ config: testConfig(), provider: new DemoProvider() }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await app?.close();
});
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("console", (m: any) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e: Error) => problems.push(e.message));
  await page.goto(base + "/");
  return { page, problems, ctx };
}

test("LEARN → PRACTICE → EVALUATE → IMPROVE: session summary appears only after all exercises, with real gaps", async () => {
  const { page, problems, ctx } = await open();
  await page.fill("#question", "Pythagoras");
  await page.click("#ask-btn");
  await page.waitForSelector('form[data-exercise-id="q3"]');
  const grade = async (id: string, fill: (f: any) => Promise<void>) => {
    const f = page.locator(`form[data-exercise-id="${id}"]`);
    await fill(f);
    await f.locator('button[type="submit"]').click();
    await f.locator("[data-verdict]").waitFor();
  };
  await grade("q1", (f) => f.locator('input[value="a"]').check()); // wrong
  assert.equal(await page.locator("#session-summary").count(), 0, "not shown before all exercises are graded");
  await grade("q2", (f) => f.locator("input").fill("17")); // wrong
  await grade("q3", (f) => f.locator("textarea").fill("In a right triangle the square of the hypotenuse equals the sum of the squares of the other two sides")); // demo keyword grading
  const s = page.locator("#session-summary");
  await s.waitFor();
  assert.equal(await s.getAttribute("data-recommendation"), "review_first");
  assert.equal(await s.locator(".stat-incorrect .stat-value").textContent(), "2");
  assert.match(await s.textContent(), /Re-read the explanation/);
  // IMPROVE: a new set at the same level is requested for the same topic.
  await s.locator('[data-action="retry"]').click();
  await page.waitForFunction(() => !document.querySelector("#session-summary") && document.querySelector('form[data-exercise-id="q1"] button[type="submit"]:not([disabled])'));
  assert.match(await page.inputValue("#question"), /The Pythagorean theorem/);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("all correct → 'try the next level' raises the level and requests a new lesson", async () => {
  const { page, ctx } = await open();
  await page.fill("#question", "expand");
  await page.click("#ask-btn");
  await page.waitForSelector('form[data-exercise-id="q3"]');
  for (const [id, act] of [
    ["q1", async (f: any) => f.locator('input[value="b"]').check()],
    ["q2", async (f: any) => f.locator("input").fill("x + 6")],
    ["q3", async (f: any) => f.locator("textarea").fill("You multiply the number outside by each term inside the brackets")],
  ] as const) {
    const f = page.locator(`form[data-exercise-id="${id}"]`);
    await act(f);
    await f.locator('button[type="submit"]').click();
    await f.locator("[data-verdict]").waitFor();
  }
  const s = page.locator("#session-summary");
  await s.waitFor();
  assert.equal(await s.getAttribute("data-recommendation"), "next_level");
  await s.locator('[data-action="next-level"]').click();
  assert.equal(await page.inputValue("#level"), "intermediate");
  await ctx.close();
});

test("KNOWLEDGE → EVIDENCE (demo): no 'Check this claim' button on demo answers (demo has no analysis for arbitrary text)", async () => {
  const { page, problems, ctx } = await open();
  await page.click("#tab-explore");
  await page.fill("#k-question", "Pythagoras");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  assert.ok((await page.locator('#k-result [data-kind="fact"]').count()) >= 1);
  assert.equal(await page.locator('#k-result [data-action="check-claim"]').count(), 0);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("KNOWLEDGE → EVIDENCE (live, fake offline AI): 'Check this claim' on a fact opens the Evidence Analyzer and analyzes it", async () => {
  const { AnthropicKnowledgeProvider } = await import("../../src/knowledge/anthropic-provider.ts");
  const { AnthropicEvidenceProvider } = await import("../../src/evidence/provider.ts");
  const { fakeClient, okResponse } = await import("../helpers/fake-client.ts");
  const { sampleKnowledgeAnswer } = await import("../helpers/knowledge.ts");
  const answer = sampleKnowledgeAnswer();
  const fact = answer.segments.find((s) => s.kind === "fact")!.text;
  const analysis = {
    understood: { claimRestated: fact, detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [{ id: "c1", text: fact, type: "factual", evidence: [], missingEvidence: "A biology textbook.", backgroundNote: null }],
    caveats: [],
  };
  const k = fakeClient([okResponse(answer, "claude-sonnet-5-5")]);
  const e = fakeClient([okResponse(analysis, "claude-opus-5-5")]);
  const live = await buildApp({
    config: testConfig({ SCIORA_RETRIEVER: "none" }),
    provider: new DemoProvider(),
    knowledgeProvider: new AnthropicKnowledgeProvider({ client: k.client, models: { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" } }),
    evidenceProvider: new AnthropicEvidenceProvider({ client: e.client, model: "claude-opus-5-5" }),
  });
  await live.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = live.app.server.address();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("pageerror", (err: Error) => problems.push(err.message));
  try {
    await page.goto(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`);
    await page.click("#tab-explore");
    await page.fill("#k-question", "What is photosynthesis?");
    await page.click("#k-ask");
    await page.waitForSelector("#k-verification");
    assert.equal(await page.locator('#k-result [data-kind="explanation"] [data-action="check-claim"]').count(), 0, "only facts can be checked");
    await page.locator('#k-result [data-kind="fact"] [data-action="check-claim"]').first().click();
    assert.equal(await page.getAttribute("#tab-evidence", "aria-selected"), "true");
    assert.equal(await page.inputValue("#e-claim"), fact);
    await page.waitForSelector("#e-overall");
    assert.equal(await page.locator("#e-overall [data-verdict]").getAttribute("data-verdict"), "insufficient_evidence", "no sources → never 'supported'");
    assert.equal(e.calls.length, 1);
    assert.deepEqual(problems, []);
  } finally {
    await ctx.close();
    await live.app.close();
  }
});

test("LIVE AI FAILURE (fake offline): friendly English errors with wait time; no demo content, no technical details or secrets", async () => {
  const { ProviderError } = await import("../../src/ai/provider.ts");
  const { StubLiveProvider } = await import("../helpers/app.ts");
  const SECRET = "fake-secret-key-0000000000000000";
  const lessonFails = new StubLiveProvider(undefined, async () => {
    throw new ProviderError("misconfigured", "The AI service is not configured correctly.");
  });
  const knowledgeFails = {
    name: "groq" as const,
    simulated: false,
    models: { learn: "openai/gpt-oss-120b", fast: "openai/gpt-oss-120b" },
    answer: async () => {
      throw new ProviderError("rate_limited", "SCIORA is busy. Please try again shortly.", 20);
    },
    transform: async () => {
      throw new ProviderError("rate_limited", "SCIORA is busy. Please try again shortly.", 20);
    },
  };
  const live = await buildApp({ config: testConfig({ SCIORA_RETRIEVER: "none" }), provider: lessonFails, knowledgeProvider: knowledgeFails as any });
  await live.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = live.app.server.address();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err: Error) => pageErrors.push(err.message));
  try {
    await page.goto(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`);
    assert.match(await page.textContent("#mode-banner"), /Live AI/);
    await page.fill("#question", "What is photosynthesis?");
    await page.click("#ask-btn");
    await page.waitForSelector("#lesson .alert-error, #lesson [role=alert]");
    const lessonText = (await page.textContent("#lesson"))!;
    assert.match(lessonText, /not configured correctly/);
    assert.equal(await page.locator('form[data-exercise-id="q1"]').count(), 0, "no demo exercises substituted");
    assert.doesNotMatch(lessonText, /DEMO|Error:|stack|at \w+ \(/);

    await page.click("#tab-explore");
    await page.fill("#k-question", "What is photosynthesis?");
    await page.click("#k-ask");
    await page.waitForFunction(() => /busy|Too many/i.test(document.querySelector("#panel-explore")?.textContent ?? ""));
    const k = (await page.textContent("#panel-explore"))!;
    assert.match(k, /Try again in 20 seconds/);
    const body = (await page.textContent("body"))!;
    assert.equal(body.includes(SECRET), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ctx.close();
    await live.app.close();
  }
});
