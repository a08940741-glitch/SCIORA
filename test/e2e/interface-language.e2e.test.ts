import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { testConfig } from "../helpers/app.ts";

/**
 * SCIORA is English-only: English interface, left-to-right, no language switcher or language
 * selectors, English demo content, and an English-only notice for non-English input.
 * Demo mode, no network.
 */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SHOTS = process.env.SCIORA_SCREENSHOT_DIR;
const ARABIC = /[؀-ۿ]/;
const NOTICE = "SCIORA currently supports English only. Please submit your question in English to continue.";
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

async function open(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("console", (m: any) => m.type() === "error" && !/status of 422/.test(m.text()) && problems.push(m.text()));
  page.on("pageerror", (e: Error) => problems.push(e.message));
  await page.goto(base + "/");
  return { page, problems, ctx };
}

test("English interface (LTR) with an international landing section", async () => {
  const { page, problems, ctx } = await open();
  assert.equal(await page.getAttribute("html", "lang"), "en");
  assert.equal(await page.getAttribute("html", "dir"), "ltr");
  assert.match(await page.title(), /Global Knowledge & Learning Intelligence/);
  assert.match(await page.textContent("#hero-title"), /Learn, explore and verify knowledge/);
  assert.match(await page.textContent("#hero-text"), /clear English/);
  assert.equal(await page.locator(".pillar").count(), 3);
  assert.equal(await page.textContent("#tab-learn"), "Learning Assistant");
  assert.equal(await page.textContent("#skip-link"), "Skip to content");
  await page.locator('.pillar[data-goto="evidence"]').click();
  assert.equal(await page.getAttribute("#tab-evidence", "aria-selected"), "true");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/english-home.png`, fullPage: false });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("no language switcher, no language selectors, no right-to-left layout — even with an old saved preference", async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => localStorage.setItem("sciora.ui.lang", "ar")); // preference saved by an older version
  await page.reload();
  assert.equal(await page.getAttribute("html", "dir"), "ltr");
  assert.equal(await page.getAttribute("html", "lang"), "en");
  for (const sel of ["#ui-lang", "#language", "#k-language", "#e-language"]) assert.equal(await page.locator(sel).count(), 0, sel);
  assert.equal(await page.locator('[dir="rtl"]').count(), 0);
  assert.doesNotMatch(await page.textContent("body"), /Interface language|Response language|Explanation language|Analysis language/);
  await ctx.close();
});

test("non-English input shows the English-only notice in all three tools (nothing is generated)", async () => {
  const { page, problems, ctx } = await open();
  await page.fill("#question", "شنو هو التركيب الضوئي؟");
  await page.click("#ask-btn");
  await page.waitForFunction((n: string) => document.querySelector("#lesson")?.textContent?.includes(n), NOTICE);
  assert.equal(await page.locator('form[data-exercise-id="q1"]').count(), 0, "no exercises generated");

  await page.click("#tab-explore");
  await page.fill("#k-question", "Qu'est-ce que la photosynthèse ?");
  await page.click("#k-ask");
  await page.waitForFunction((n: string) => document.querySelector("#panel-explore")?.textContent?.includes(n), NOTICE);

  await page.click("#tab-evidence");
  await page.fill("#e-claim", "chno howa tarkib daw2i");
  await page.click("#e-analyze");
  await page.waitForFunction((n: string) => document.querySelector("#panel-evidence")?.textContent?.includes(n), NOTICE);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("full English experience: chips, lesson, exercises, feedback, explorer answer and evidence analysis — no Arabic script", async () => {
  const { page, problems, ctx } = await open();
  const chips: string[] = await page.locator("#demo-topics .chip").allInnerTexts();
  assert.equal(chips.length, 5);
  assert.ok(chips.every((c) => !ARABIC.test(c)), chips.join(" | "));
  await page.locator("#demo-topics .chip", { hasText: "The water cycle" }).click();
  assert.equal(await page.inputValue("#question"), "The water cycle");
  await page.click("#ask-btn");
  await page.waitForSelector('form[data-exercise-id="q3"]');
  assert.match(await page.textContent("#lesson"), /Simple explanation/);
  assert.equal(ARABIC.test((await page.textContent("#lesson")) ?? ""), false, "lesson has no Arabic");
  assert.equal(ARABIC.test((await page.textContent("#exercises")) ?? ""), false, "exercises have no Arabic");
  const q1 = page.locator('form[data-exercise-id="q1"]');
  await q1.locator('input[value="b"]').check();
  await q1.locator('button[type="submit"]').click();
  await q1.locator("[data-verdict]").waitFor();
  assert.equal(ARABIC.test((await q1.textContent()) ?? ""), false, "feedback has no Arabic");

  await page.click("#tab-explore");
  await page.locator("#k-topics .chip", { hasText: "Photosynthesis" }).click();
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  assert.equal(ARABIC.test((await page.textContent("#k-result")) ?? ""), false, "explorer answer has no Arabic");

  await page.click("#tab-evidence");
  const eChips: string[] = await page.locator("#e-claims .chip").allInnerTexts();
  assert.ok(eChips.length === 5 && eChips.every((c) => !ARABIC.test(c)), eChips.join(" | "));
  await page.locator("#e-claims .chip").first().click();
  await page.click("#e-analyze");
  await page.waitForSelector("#e-result [data-subclaim]");
  assert.equal(ARABIC.test((await page.textContent("#e-result")) ?? ""), false, "evidence analysis has no Arabic");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("interface text on every tab is English (no Arabic script anywhere in the visible chrome)", async () => {
  const { page, problems, ctx } = await open();
  for (const tab of ["learn", "explore", "evidence", "cards", "progress"]) {
    await page.click(`#tab-${tab}`);
    const text: string = await page.locator("body").innerText();
    assert.equal(ARABIC.test(text), false, `tab ${tab}`);
  }
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("English interface on mobile: layout without horizontal overflow", async () => {
  const { page, problems, ctx } = await open({ width: 390, height: 844 });
  await page.click("#tab-evidence");
  await page.fill("#e-claim", "The Sun orbits the Earth");
  await page.click("#e-analyze");
  await page.waitForSelector("#e-overall");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("small phone (360px): Knowledge Explorer with the quiz open has no horizontal overflow (long DEMO badge wraps)", async () => {
  const { page, problems, ctx } = await open({ width: 360, height: 740 });
  await page.click("#tab-explore");
  await page.fill("#k-question", "What is the water cycle?");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  await page.locator('#k-result button[data-mode="quiz"]').click();
  await page.waitForSelector('[data-transform="quiz"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  assert.deepEqual(problems, []);
  await ctx.close();
});
