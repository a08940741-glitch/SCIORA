import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { AnthropicKnowledgeProvider } from "../../src/knowledge/anthropic-provider.ts";
import type { SourceRetriever } from "../../src/knowledge/retriever.ts";
import { testConfig } from "../helpers/app.ts";
import { fakeClient, okResponse } from "../helpers/fake-client.ts";
import { fakeSource, sampleKnowledgeAnswer } from "../helpers/knowledge.ts";

/** Knowledge Explorer browser tests. Demo mode, plus a FAKE live provider/retriever (no network). */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SHOTS = process.env.SCIORA_SCREENSHOT_DIR;

let browser: any;
const apps: any[] = [];

async function startApp(opts: Parameters<typeof buildApp>[0] extends infer P ? Partial<P> : never = {}) {
  const { app } = await buildApp({ config: testConfig(), provider: new DemoProvider(), ...opts } as any);
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const addr = app.server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

let demoBase = "";
before(async () => {
  browser = await chromium.launch();
  demoBase = await startApp();
});
after(async () => {
  await browser?.close();
  for (const a of apps) await a.close();
});

async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  const apiCalls: string[] = [];
  page.on("console", (m: any) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e: Error) => problems.push(e.message));
  page.on("request", (r: any) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) apiCalls.push(`${r.method()} ${u.pathname}`);
  });
  return { page, problems, apiCalls, ctx };
}

async function askExplorer(page: any, base: string, question: string) {
  await page.goto(base + "/");
  await page.click("#tab-explore");
  await page.fill("#k-question", question);
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
}

test("explorer demo flow: labelled answer, no sources, suggestions, learning mode, save card", async () => {
  const { page, problems, apiCalls, ctx } = await newPage();
  await page.goto(demoBase + "/");

  // Tabs: learning assistant selected by default; explorer panel hidden.
  assert.equal(await page.getAttribute("#tab-learn", "aria-selected"), "true");
  assert.equal(await page.isHidden("#panel-explore"), true);
  await page.click("#tab-explore");
  assert.equal(await page.getAttribute("#tab-explore", "aria-selected"), "true");
  assert.equal(await page.isVisible("#panel-explore"), true);
  assert.equal(await page.isHidden("#panel-learn"), true);
  await page.waitForSelector("#k-topics .chip");
  assert.equal(await page.locator("#k-topics .chip").count(), 5);

  await page.fill("#k-question", "What is photosynthesis?");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");

  // Verification: demo, never "verified"; explicit empty sources state.
  assert.equal(await page.getAttribute("#k-verification", "data-status"), "demo");
  assert.match(await page.textContent("#k-verification"), /ماشي موثق بمصادر/);
  assert.equal(await page.locator("#k-no-sources").count(), 1);
  assert.equal(await page.locator("#k-result a[href^='http']").count(), 0, "no external links in demo");

  // Every explorer card is labelled DEMO; none claims AI.
  const cards = await page.locator("#k-result .card").count();
  assert.ok(cards >= 6, `cards: ${cards}`);
  assert.equal(await page.locator('#k-result [data-provenance="ai"]').count(), 0);
  assert.ok((await page.locator('#k-result [data-provenance="demo"]').count()) >= cards);

  // Segment kinds shown; at least one fact and one uncertainty/assumption.
  const kinds = await page.locator("#k-result [data-kind]").evaluateAll((els: Element[]) => els.map((e) => e.getAttribute("data-kind")));
  assert.ok(kinds.includes("fact"));
  assert.ok(kinds.some((k: string) => k === "uncertainty" || k === "assumption"));

  // Connections are labelled as suggestions; "explore this concept" fills the question.
  const conns = page.locator("#k-result [data-suggested='true']");
  assert.ok((await conns.count()) >= 1);
  assert.equal(await page.locator("#k-result .badge-suggestion").count(), await conns.count());
  await conns.first().locator("button").click();
  assert.notEqual(await page.inputValue("#k-question"), "What is photosynthesis?");

  // Learning mode: simplify, examples, quiz.
  await page.click('[data-mode="simplify"]');
  await page.waitForSelector('[data-transform="simplify"]');
  await page.click('[data-mode="examples"]');
  await page.waitForSelector('[data-transform="examples"]');
  await page.click('[data-mode="quiz"]');
  await page.waitForSelector('[data-transform="quiz"]');
  assert.match(await page.textContent('[data-transform="quiz"]'), /تمرين ذاتي/);

  // Self-check is local: no grading request is sent.
  const before = apiCalls.length;
  const q0 = page.locator('[data-quiz-question="0"]');
  await q0.locator('input[value="a"]').check();
  await q0.locator("button").click();
  assert.equal(await q0.locator("[data-self-result]").getAttribute("data-self-result"), "right");
  const q1 = page.locator('[data-quiz-question="1"]');
  await q1.locator('input[value="a"]').check();
  await q1.locator("button").click();
  assert.equal(await q1.locator("[data-self-result]").getAttribute("data-self-result"), "wrong");
  assert.equal(apiCalls.length, before, "self-check quiz made no API call");
  assert.equal(apiCalls.some((c) => c.includes("/api/grade")), false);
  assert.equal(await page.locator(".estimate-line").count(), 0, "quiz does not touch the level estimate");

  // Save as a card in a named collection.
  await page.fill("#k-collection", "بيولوجيا");
  await page.click("#k-save");
  assert.match(await page.textContent("#k-save-msg"), /تحفظات/);
  assert.equal(await page.isDisabled("#k-save"), true);

  // Cards tab: card present with demo status.
  await page.click("#tab-cards");
  const card = page.locator("[data-card-id]");
  assert.equal(await card.count(), 1);
  assert.equal(await card.locator("[data-card-status]").getAttribute("data-card-status"), "demo");
  assert.match(await page.textContent("#c-count"), /1 \/ 200/);

  // "Checked by me" toggle never changes the source status.
  await card.locator('[data-action="checked"]').click();
  assert.equal(await page.locator("[data-checked='true']").count(), 1);
  assert.equal(await page.locator("[data-card-status]").getAttribute("data-card-status"), "demo");

  // Search and collection filter.
  await page.fill("#c-search", "zzzz-no-match");
  assert.equal(await page.locator("[data-card-id]").count(), 0);
  await page.fill("#c-search", "");
  await page.selectOption("#c-collection", "بيولوجيا");
  assert.equal(await page.locator("[data-card-id]").count(), 1);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/explorer-cards.png`, fullPage: true });

  // Delete with confirmation → empty state.
  page.once("dialog", (d: any) => d.accept());
  await page.locator('[data-action="delete"]').click();
  await page.selectOption("#c-collection", "");
  assert.equal(await page.locator("#c-empty").count(), 1);

  assert.deepEqual(problems, [], "no console errors / CSP violations");
  await ctx.close();
});

test("explorer: unknown topic in demo shows a localized error, no invented content", async () => {
  const { page, ctx } = await newPage();
  await page.goto(demoBase + "/");
  await page.click("#tab-explore");
  await page.fill("#k-question", "شكون ربح كاس العالم؟");
  await page.click("#k-ask");
  await page.waitForSelector("#k-result .alert-error");
  assert.match(await page.textContent("#k-result"), /وضع DEMO/);
  assert.equal(await page.locator("#k-verification").count(), 0);
  await ctx.close();
});

test("no English leakage in explorer and cards interface text (content excluded)", async () => {
  const { page, ctx } = await newPage();
  await askExplorer(page, demoBase, "دورة الماء");
  await page.click('[data-mode="quiz"]');
  await page.waitForSelector('[data-transform="quiz"]');
  await page.click("#k-save");
  const allowed = /^(DEMO|SCIORA|Claude|JSON|English|Français)$/;
  const chrome = async (sel: string) =>
    page.locator(sel).evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).innerText));
  const texts = [
    ...(await chrome("#panel-explore h2, #panel-explore label, #panel-explore .badge, #panel-explore .verification, #panel-explore .kind-chip, #panel-explore .empty-state, #k-result .card-head h3, #k-learning .alert, #k-result button, #k-save-msg, #tab-learn, #tab-explore, #tab-cards")),
  ];
  await page.click("#tab-cards");
  texts.push(...(await chrome("#panel-cards h2, #panel-cards .badge, #panel-cards button, #c-count, #c-intro")));
  assert.ok(texts.length >= 30, `only ${texts.length} interface texts collected`);
  assert.ok(texts.join("").length > 300, "interface text actually collected");
  const leaks = texts.flatMap((t: string) => (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w: string) => !allowed.test(w)));
  assert.deepEqual(leaks, [], `English words in Arabic UI: ${leaks.join(", ")}`);
  await ctx.close();
});

test("tabs support keyboard navigation (RTL arrows)", async () => {
  const { page, ctx } = await newPage();
  await page.goto(demoBase + "/");
  await page.focus("#tab-learn");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getAttribute("#tab-explore", "aria-selected"), "true");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getAttribute("#tab-cards", "aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getAttribute("#tab-explore", "aria-selected"), "true");
  await ctx.close();
});

test("tampered cards in localStorage render safely (no javascript: links, status downgraded)", async () => {
  const { page, problems, ctx } = await newPage();
  await page.goto(demoBase + "/");
  await page.evaluate(() => {
    localStorage.setItem(
      "sciora.cards.v1",
      JSON.stringify({
        version: 1,
        cards: [
          { id: "card-evil-000001", title: "<img src=x onerror=alert(1)>", summary: "s", origin: "ai", verificationStatus: "sources_attached", sources: [{ title: "evil", url: "javascript:alert(1)" }] },
        ],
      }),
    );
  });
  await page.reload();
  await page.click("#tab-cards");
  const card = page.locator("[data-card-id]");
  assert.equal(await card.count(), 1);
  assert.equal(await card.locator("h3").textContent(), "<img src=x onerror=alert(1)>", "rendered as text, not HTML");
  assert.equal(await card.locator("img").count(), 0);
  assert.equal(await page.locator("a[href^='javascript']").count(), 0);
  assert.equal(await card.locator("[data-card-status]").getAttribute("data-card-status"), "not_source_verified");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("mobile: explorer renders in RTL without horizontal overflow", async () => {
  const { page, problems, ctx } = await newPage({ width: 390, height: 844 });
  await askExplorer(page, demoBase, "فيثاغورس");
  await page.click('[data-mode="examples"]');
  await page.waitForSelector('[data-transform="examples"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/explorer-mobile.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("FAKE live provider + FAKE retriever: AI label, source_backed banner, safe https source links", async () => {
  const answer = sampleKnowledgeAnswer();
  answer.segments[0]!.sourceIds = ["S1"];
  const fc = fakeClient([okResponse(answer, "claude-sonnet-5-5")]);
  const retriever: SourceRetriever = { name: "fake-test-retriever", enabled: true, search: async () => [fakeSource()] };
  const base = await startApp({
    knowledgeProvider: new AnthropicKnowledgeProvider({ client: fc.client, models: { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" } }),
    retriever,
  } as any);
  const { page, problems, ctx } = await newPage();
  await askExplorer(page, base, "What is photosynthesis?");
  assert.equal(await page.getAttribute("#k-verification", "data-status"), "source_backed");
  assert.match(await page.textContent("#k-verification"), /ما كيعنيش بالضرورة/);
  assert.ok((await page.locator('#k-result [data-provenance="ai"]').count()) >= 1);
  assert.equal(await page.locator('#k-result [data-provenance="demo"]').count(), 0);
  const link = page.locator("#k-src-S1 a");
  assert.equal(await link.getAttribute("href"), "https://example.org/fake-test-source");
  assert.match(String(await link.getAttribute("rel")), /noopener/);
  assert.match(await page.textContent("#k-result"), /\[S1\]/);
  assert.deepEqual(problems, []);
  await ctx.close();
});
