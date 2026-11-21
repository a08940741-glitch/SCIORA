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
  await page.fill("#question", "ننشر");
  await page.click("#ask-btn");
  await page.waitForSelector('form[data-exercise-id="q3"]');
  for (const [id, act] of [
    ["q1", async (f: any) => f.locator('input[value="b"]').check()],
    ["q2", async (f: any) => f.locator("input").fill("x + 6")],
    ["q3", async (f: any) => f.locator("textarea").fill("كنضربو العدد اللي برا فكل حد داخل القوس")],
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

test("KNOWLEDGE → EVIDENCE: 'Check this claim' on a fact opens the Evidence Analyzer and analyzes it", async () => {
  const { page, problems, ctx } = await open();
  await page.click("#tab-explore");
  await page.fill("#k-question", "فيثاغورس");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  const facts = page.locator('#k-result [data-kind="fact"]');
  assert.ok((await facts.count()) >= 1);
  assert.equal(await page.locator('#k-result [data-kind="explanation"] [data-action="check-claim"]').count(), 0, "only facts can be checked");
  const factText = (await facts.first().locator(".segment-text").textContent())!;
  await facts.first().locator('[data-action="check-claim"]').click();
  assert.equal(await page.getAttribute("#tab-evidence", "aria-selected"), "true");
  assert.equal(await page.inputValue("#e-claim"), factText);
  // Demo has no analysis for arbitrary text → honest error, never a fabricated verdict.
  await page.waitForSelector("#e-result .alert-error, #e-overall");
  if (await page.locator("#e-overall").count()) {
    assert.notEqual(await page.locator("#e-overall [data-verdict]").getAttribute("data-verdict"), "supported");
  } else {
    assert.match(await page.textContent("#e-result"), /Demo mode/);
  }
  // The expected 404 (not available in demo) is logged by Chrome as a resource error; no script errors allowed.
  assert.deepEqual(problems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p)), []);
  await ctx.close();
});
