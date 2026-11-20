import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { testConfig } from "../helpers/app.ts";

/**
 * Browser end-to-end test in DEMO mode (no AI, no network beyond localhost).
 * Uses the pre-installed Chromium/Playwright.
 */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SHOTS = process.env.SCIORA_SCREENSHOT_DIR;

let app: Awaited<ReturnType<typeof buildApp>>["app"];
let base = "";
let browser: any;

before(async () => {
  ({ app } = await buildApp({ config: testConfig(), provider: new DemoProvider() }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await app?.close();
});

async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("console", (m: any) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e: Error) => problems.push(e.message));
  return { page, problems, ctx };
}

test("demo flow: question → labelled lesson → exercises → feedback → preliminary estimate", async () => {
  const { page, problems, ctx } = await newPage();
  await page.goto(base + "/");

  // RTL Arabic page, demo banner.
  // English-first international interface (default).
  assert.equal(await page.getAttribute("html", "dir"), "ltr");
  assert.equal(await page.getAttribute("html", "lang"), "en");
  await page.waitForSelector("#mode-banner.mode-demo");
  assert.match(await page.textContent("#mode-banner"), /Demo mode/);

  // Demo topic chips fill the question box (no dead buttons).
  // Scoped to the learning panel: the Knowledge Explorer panel (Phase 2A) has its own topic chips.
  const chips = page.locator("#demo-topics .chip");
  assert.equal(await chips.count(), 5);
  await chips.first().click();
  assert.ok((await page.inputValue("#question")).length > 3);

  await page.fill("#question", "شنو هو التركيب الضوئي؟");
  await page.click("#ask-btn");
  await page.waitForSelector("#lesson .card");

  // Every content card carries the DEMO provenance badge; none claims to be AI.
  const lessonCards = await page.locator("#lesson .card").count();
  const exerciseCards = await page.locator("#exercises .card").count();
  assert.ok(lessonCards >= 5, `lesson cards: ${lessonCards}`);
  assert.equal(exerciseCards, 3);
  assert.equal(await page.locator('[data-provenance="demo"]').count(), lessonCards + exerciseCards);
  assert.equal(await page.locator('[data-provenance="ai"]').count(), 0);

  // Example solution toggle works.
  const sol = page.locator("#lesson .solution");
  assert.equal(await sol.isHidden(), true);
  await page.locator("#lesson .card button.btn-secondary").first().click();
  assert.equal(await sol.isVisible(), true);

  // MCQ q1: choose correct option "a".
  const q1 = page.locator('form[data-exercise-id="q1"]');
  await q1.locator('input[value="a"]').check();
  await q1.locator('button[type="submit"]').click();
  await q1.locator('[data-verdict="correct"]').waitFor();
  assert.equal(await q1.locator('[data-graded-by="rules"]').count(), 1);
  assert.equal(await q1.locator('button[type="submit"]').isDisabled(), true, "one attempt: locked after grading");

  // Hint toggle works.
  const q3 = page.locator('form[data-exercise-id="q3"]');
  await q3.locator(".btn-link").click();
  assert.equal(await q3.locator(".hint").isVisible(), true);

  // Written answer in Darija with the key ideas → demo keyword grading → correct, labelled DEMO.
  await q3.locator("textarea").fill("النبتة كتاخد الضو ديال الشمس والماء وثاني أكسيد الكربون وكتصاوب السكر");
  await q3.locator('button[type="submit"]').click();
  await q3.locator('[data-verdict="correct"]').waitFor();
  assert.equal(await q3.locator('[data-graded-by="demo"]').count(), 1);

  // Preliminary estimate: 2 graded answers, low confidence, never "mastery".
  const line = page.locator(".estimate-line");
  assert.equal(await line.getAttribute("data-answers"), "2");
  assert.match(await page.textContent("#estimate"), /preliminary estimate/);
  assert.match(await page.textContent("#estimate"), /not proof of mastery/);

  // Planned-but-not-implemented features are not offered as working links or buttons.
  // (Explorer — Phase 2A — and Evidence Analyzer — Phase 2B — are now implemented, so the
  //  check targets the remaining planned feature: optional Google Sign-In.)
  const navTexts = await page.locator("a, button").allTextContents();
  assert.equal(navTexts.some((t: string) => /Google|تسجيل الدخول|sign in/i.test(t)), false);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-demo-flow.png`, fullPage: true });
  assert.deepEqual(problems, [], "no console errors / CSP violations");
  await ctx.close();
});

test("uncertain written answer is explained and not counted in the estimate", async () => {
  const { page, problems, ctx } = await newPage();
  await page.goto(base + "/");
  await page.waitForSelector("#mode-banner.mode-demo");
  await page.fill("#question", "مبدأ القصور");
  await page.click("#ask-btn");
  await page.waitForSelector('form[data-exercise-id="q3"]');
  const q3 = page.locator('form[data-exercise-id="q3"]');
  await q3.locator("textarea").fill("ما عرفتش");
  await q3.locator('button[type="submit"]').click();
  await q3.locator('[data-verdict="uncertain"]').waitFor();
  assert.match(await q3.textContent(), /not sure about this grade/);
  assert.equal(await page.locator(".estimate-line").count(), 0, "uncertain does not create an estimate");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("unknown topic in demo mode shows an honest message, not invented content", async () => {
  const { page, ctx } = await newPage();
  await page.goto(base + "/");
  await page.fill("#question", "شكون ربح كاس العالم؟");
  await page.click("#ask-btn");
  await page.waitForSelector("#lesson .alert-error");
  assert.match(await page.textContent("#lesson"), /Demo mode/);
  assert.equal(await page.locator("#exercises .card").count(), 0);
  await ctx.close();
});

test("mobile layout renders the workspace in RTL without horizontal overflow", async () => {
  const { page, problems, ctx } = await newPage({ width: 390, height: 844 });
  await page.goto(base + "/");
  await page.fill("#question", "دورة الماء");
  await page.click("#ask-btn");
  await page.waitForSelector("#exercises .card");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mobile-demo.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("clear my data removes the stored estimate", async () => {
  const { page, ctx } = await newPage();
  await page.goto(base + "/");
  await page.fill("#question", "فيثاغورس");
  await page.click("#ask-btn");
  const q1 = page.locator('form[data-exercise-id="q1"]');
  await q1.locator('input[value="b"]').check();
  await q1.locator('button[type="submit"]').click();
  await q1.locator("[data-verdict]").waitFor();
  assert.ok(await page.evaluate(() => localStorage.getItem("sciora.learner.v1")));
  page.once("dialog", (d: any) => d.accept());
  await page.click("#clear-btn");
  assert.equal(await page.evaluate(() => localStorage.getItem("sciora.learner.v1")), null);
  await ctx.close();
});
