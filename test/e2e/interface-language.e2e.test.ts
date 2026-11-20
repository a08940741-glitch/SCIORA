import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { testConfig } from "../helpers/app.ts";

/**
 * Interface language (English default, Arabic optional) is independent from the
 * learning / AI response language. Demo mode, no network.
 */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SHOTS = process.env.SCIORA_SCREENSHOT_DIR;
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
  page.on("console", (m: any) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e: Error) => problems.push(e.message));
  await page.goto(base + "/");
  return { page, problems, ctx };
}

test("default interface is English (LTR) with an international landing section", async () => {
  const { page, problems, ctx } = await open();
  assert.equal(await page.getAttribute("html", "lang"), "en");
  assert.equal(await page.getAttribute("html", "dir"), "ltr");
  assert.match(await page.title(), /Global Knowledge & Learning Intelligence/);
  assert.equal(await page.inputValue("#ui-lang"), "en");
  assert.match(await page.textContent("#hero-title"), /Learn, explore and verify knowledge/);
  assert.equal(await page.locator(".pillar").count(), 3);
  assert.equal(await page.textContent("#tab-learn"), "Learning Assistant");
  assert.equal(await page.textContent("#skip-link"), "Skip to content");
  // Pillars navigate to their tool.
  await page.locator('.pillar[data-goto="evidence"]').click();
  assert.equal(await page.getAttribute("#tab-evidence", "aria-selected"), "true");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/english-home.png`, fullPage: false });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("Arabic content renders right-to-left inside the English interface", async () => {
  const { page, ctx } = await open();
  await page.fill("#question", "شنو هو التركيب الضوئي؟");
  await page.click("#ask-btn");
  await page.waitForSelector("#lesson .card p");
  // Pure content paragraphs (no child elements) that start with Arabic must render RTL.
  const dirs = await page.locator("#lesson .card p").evaluateAll((els: Element[]) =>
    els.filter((e) => e.children.length === 0 && /^\s*[\u0600-\u06FF]/.test(e.textContent ?? "")).map((e) => getComputedStyle(e).direction),
  );
  assert.ok(dirs.length >= 3, `content paragraphs found: ${dirs.length}`);
  assert.ok(dirs.every((d: string) => d === "rtl"), `directions: ${dirs.join(",")}`);
  // Mixed interface line (English label + Arabic topic): the Arabic topic is isolated as RTL.
  const topicDir = await page.locator("#lesson .card p strong").first().evaluate((e: Element) => getComputedStyle(e).direction);
  assert.equal(topicDir, "rtl");
  assert.equal(await page.getAttribute("html", "dir"), "ltr", "page stays LTR");
  // System notices are shown in the interface language.
  assert.match(await page.textContent("#lesson .notices"), /Demo content: pre-written/);
  await ctx.close();
});

test("interface language stays English when the response language is Darija or English", async () => {
  const { page, ctx } = await open();
  await page.click("#tab-explore");
  assert.equal(await page.inputValue("#k-language"), "darija", "response language default is independent");
  await page.selectOption("#k-language", "en");
  await page.fill("#k-question", "What is the water cycle?");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  assert.equal(await page.getAttribute("html", "lang"), "en");
  // Demo content exists only in Darija → honest notice, in English.
  assert.equal(await page.locator('[data-notice="demo_language_fixed"]').count(), 1);
  assert.match(await page.textContent('[data-notice="demo_language_fixed"]'), /available in Darija only/);
  await ctx.close();
});

test("switching the interface to Arabic: RTL, Darija labels, no English leakage, RTL arrow keys", async () => {
  const { page, problems, ctx } = await open();
  await Promise.all([page.waitForNavigation(), page.selectOption("#ui-lang", "ar")]);
  assert.equal(await page.getAttribute("html", "lang"), "ar");
  assert.equal(await page.getAttribute("html", "dir"), "rtl");
  assert.equal(await page.textContent("#tab-learn"), "مساعد التعلم");
  assert.equal(await page.inputValue("#ui-lang"), "ar");

  // Arabic interface chrome has no English words (content excluded).
  await page.click("#tab-explore");
  await page.fill("#k-question", "دورة الماء");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  const texts: string[] = await page
    .locator("#hero-title, #hero-text, .pillar, [role=tab], #panel-explore h2, #panel-explore label:not(.choice), #panel-explore .badge, #panel-explore .verification, #panel-explore .kind-chip, .notices li, #k-result button, #responsible, #estimate-title, #footer")
    .evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).innerText));
  assert.ok(texts.length >= 20);
  const allowed = /^(DEMO|SCIORA|Claude|JSON|English|Français|WAICY)$/;
  const leaks = texts.flatMap((t) => (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !allowed.test(w)));
  assert.deepEqual(leaks, [], `English words in the Arabic interface: ${leaks.join(", ")}`);

  // RTL keyboard: ArrowLeft moves to the next tab.
  await page.focus("#tab-learn");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getAttribute("#tab-explore", "aria-selected"), "true");

  // Persisted across reloads; switching back restores English.
  await page.reload();
  assert.equal(await page.getAttribute("html", "dir"), "rtl");
  await Promise.all([page.waitForNavigation(), page.selectOption("#ui-lang", "en")]);
  assert.equal(await page.getAttribute("html", "lang"), "en");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("tampered interface-language value falls back to English", async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => localStorage.setItem("sciora.ui.lang", "<script>"));
  await page.reload();
  assert.equal(await page.getAttribute("html", "lang"), "en");
  await ctx.close();
});

test("mobile: English landing and tabs without horizontal overflow", async () => {
  const { page, problems, ctx } = await open({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/english-mobile.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("sidebar navigation: ArrowDown/ArrowUp/Home/End move between tabs (vertical tablist)", async () => {
  const { page, ctx } = await open();
  assert.equal(await page.getAttribute(".tabs", "aria-orientation"), "vertical");
  await page.focus("#tab-learn");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.getAttribute("#tab-explore", "aria-selected"), "true");
  await page.keyboard.press("End");
  assert.equal(await page.getAttribute("#tab-progress", "aria-selected"), "true");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.getAttribute("#tab-cards", "aria-selected"), "true");
  await page.keyboard.press("Home");
  assert.equal(await page.getAttribute("#tab-learn", "aria-selected"), "true");
  // Tab labels are text next to decorative icons (icons are aria-hidden).
  assert.equal(await page.locator("#tab-learn svg[aria-hidden='true']").count(), 1);
  await ctx.close();
});

test("Arabic interface on mobile: RTL layout without horizontal overflow", async () => {
  const { page, problems, ctx } = await open({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem("sciora.ui.lang", "ar"));
  await page.reload();
  assert.equal(await page.getAttribute("html", "dir"), "rtl");
  await page.click("#tab-evidence");
  await page.fill("#e-claim", "الشمس كتدور على الأرض");
  await page.click("#e-analyze");
  await page.waitForSelector("#e-overall");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  assert.deepEqual(problems, []);
  await ctx.close();
});
