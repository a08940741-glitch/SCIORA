import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { testConfig } from "../helpers/app.ts";

/** Learning Progress browser tests (demo mode; data only from this browser). */
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

async function page0(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("console", (m: any) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e: Error) => problems.push(e.message));
  return { page, problems, ctx };
}

test("empty progress: honest empty state, zero stats", async () => {
  const { page, problems, ctx } = await page0();
  await page.goto(base + "/");
  await page.click("#tab-progress");
  assert.equal(await page.locator("#p-empty").count(), 1);
  assert.equal(await page.textContent("#p-stat-graded .stat-value"), "0");
  assert.equal(await page.locator("[data-progress-topic]").count(), 0);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("progress reflects real graded answers; weak topic flagged; practice button returns to learning", async () => {
  const { page, problems, ctx } = await page0();
  await page.goto(base + "/");
  // Two wrong answers on the Pythagoras demo lesson (MCQ b, numeric 17).
  await page.fill("#question", "فيثاغورس");
  await page.click("#ask-btn");
  const q1 = page.locator('form[data-exercise-id="q1"]');
  await q1.locator('input[value="a"]').check();
  await q1.locator('button[type="submit"]').click();
  await q1.locator("[data-verdict]").waitFor();
  const q2 = page.locator('form[data-exercise-id="q2"]');
  await q2.locator("input").fill("17");
  await q2.locator('button[type="submit"]').click();
  await q2.locator("[data-verdict]").waitFor();
  // An "uncertain" written answer must NOT be counted.
  const q3 = page.locator('form[data-exercise-id="q3"]');
  await q3.locator("textarea").fill("ما عرفتش");
  await q3.locator('button[type="submit"]').click();
  await q3.locator('[data-verdict="uncertain"]').waitFor();

  await page.click("#tab-progress");
  assert.equal(await page.textContent("#p-stat-topics .stat-value"), "1");
  assert.equal(await page.textContent("#p-stat-graded .stat-value"), "2", "uncertain answer not counted");
  assert.equal(await page.textContent("#p-stat-correct .stat-value"), "0");
  const topic = page.locator("[data-progress-topic]");
  assert.equal(await topic.count(), 1);
  assert.equal(await topic.getAttribute("data-recommendation"), "review");
  assert.match(await topic.textContent(), /Needs review/);
  assert.match(await page.textContent("#panel-progress"), /preliminary estimate/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/progress.png`, fullPage: true });

  await topic.locator('[data-action="practice"]').click();
  assert.equal(await page.getAttribute("#tab-learn", "aria-selected"), "true");
  assert.match(await page.inputValue("#question"), /فيثاغورس/);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("saved cards are counted; clearing my data empties progress", async () => {
  const { page, ctx } = await page0();
  await page.goto(base + "/");
  await page.click("#tab-explore");
  await page.fill("#k-question", "دورة الماء");
  await page.click("#k-ask");
  await page.waitForSelector("#k-save");
  await page.click("#k-save");
  await page.click("#tab-progress");
  assert.equal(await page.textContent("#p-stat-cards .stat-value"), "1");
  await page.click("#tab-learn");
  await page.fill("#question", "دورة الماء");
  await page.click("#ask-btn");
  const q1 = page.locator('form[data-exercise-id="q1"]');
  await q1.locator('input[value="b"]').check();
  await q1.locator('button[type="submit"]').click();
  await q1.locator("[data-verdict]").waitFor();
  page.once("dialog", (d: any) => d.accept());
  await page.click("#clear-btn");
  await page.click("#tab-progress");
  assert.equal(await page.locator("#p-empty").count(), 1);
  await ctx.close();
});

test("English interface: no Arabic script in progress interface; mobile without overflow", async () => {
  const { page, problems, ctx } = await page0({ width: 390, height: 844 });
  await page.goto(base + "/");
  await page.click("#tab-progress");
  const texts: string[] = await page.locator("#panel-progress h2, #panel-progress .stat-label, #panel-progress .empty-state, #tab-progress").evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).innerText));
  assert.ok(texts.length >= 6);
  const leaks = texts.flatMap((t) => (t.match(/[\u0600-\u06FF]+/g) ?? []));
  assert.deepEqual(leaks, [], `Arabic script in the English interface: ${leaks.join(" ")}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  assert.deepEqual(problems, []);
  await ctx.close();
});
