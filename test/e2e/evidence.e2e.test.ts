import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { AnthropicEvidenceProvider } from "../../src/evidence/provider.ts";
import type { SourceRetriever } from "../../src/knowledge/retriever.ts";
import { testConfig } from "../helpers/app.ts";
import { fakeClient, okResponse } from "../helpers/fake-client.ts";
import { fakeSource } from "../helpers/knowledge.ts";

/** Evidence Analyzer browser tests (demo + FAKE live provider/retriever; no network). */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SHOTS = process.env.SCIORA_SCREENSHOT_DIR;
let browser: any;
const apps: any[] = [];
let demoBase = "";

async function startApp(extra: Record<string, unknown> = {}) {
  const { app } = await buildApp({ config: testConfig(), provider: new DemoProvider(), ...extra } as any);
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const a = app.server.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}
before(async () => {
  browser = await chromium.launch();
  demoBase = await startApp();
});
after(async () => {
  await browser?.close();
  for (const a of apps) await a.close();
});

async function analyzePage(base: string, claim: string, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("console", (m: any) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e: Error) => problems.push(e.message));
  await page.goto(base + "/");
  await page.click("#tab-evidence");
  await page.fill("#e-claim", claim);
  await page.click("#e-analyze");
  return { page, problems, ctx };
}

test("demo: factual claim → insufficient evidence, honest basis banner, background labelled not evidence", async () => {
  const { page, problems, ctx } = await analyzePage(demoBase, "The Sun orbits the Earth");
  await page.waitForSelector("#e-basis");
  assert.equal(await page.getAttribute("#e-basis", "data-basis"), "none");
  assert.match(await page.textContent("#e-basis"), /not evidence/i);
  assert.equal(await page.locator("#e-overall [data-verdict]").getAttribute("data-verdict"), "insufficient_evidence");
  assert.equal(await page.locator("#e-result .e-no-evidence").count(), 1);
  const bg = page.locator("[data-not-evidence='true']");
  assert.equal(await bg.count(), 1);
  assert.match(await bg.textContent(), /not evidence/i);
  assert.equal(await page.locator('#e-result [data-provenance="ai"]').count(), 0);
  assert.equal(await page.locator("#e-result a[href^='http']").count(), 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/evidence-demo.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("demo: opinion → not checkable; compound claim → two sub-claims", async () => {
  const a = await analyzePage(demoBase, "Mathematics is the hardest school subject");
  await a.page.waitForSelector("#e-overall");
  assert.equal(await a.page.locator("#e-overall [data-verdict]").getAttribute("data-verdict"), "not_checkable");
  assert.equal(await a.page.locator("[data-type='opinion']").count(), 1);
  await a.ctx.close();
  const b = await analyzePage(demoBase, "Pythagoras works for every triangle");
  await b.page.waitForSelector("#e-overall");
  assert.equal(await b.page.locator("[data-subclaim]").count(), 2);
  await b.ctx.close();
});

test("demo claim chips fill the claim box; unknown claim shows a localized error", async () => {
  const { page, ctx } = await analyzePage(demoBase, "claim that matches nothing at all");
  await page.waitForSelector("#e-result .alert-error");
  assert.match(await page.textContent("#e-result"), /Demo mode/);
  assert.equal(await page.locator("#e-claims .chip").count(), 5);
  await page.locator("#e-claims .chip").first().click();
  assert.ok((await page.inputValue("#e-claim")).length > 5);
  await ctx.close();
});

test("English interface: no Arabic script in evidence interface text (content excluded)", async () => {
  const { page, ctx } = await analyzePage(demoBase, "Water boils at 100 degrees everywhere");
  await page.waitForSelector("#e-overall");
  const texts = await page
    .locator("#panel-evidence h2, #panel-evidence label, #panel-evidence .badge, #panel-evidence .verdict-chip, #panel-evidence .verification, #panel-evidence .label, #panel-evidence .empty-state, #e-analyze, #tab-evidence")
    .evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).innerText));
  assert.ok(texts.length >= 15, `only ${texts.length} texts`);
  const leaks = texts.flatMap((t: string) => (t.match(/[\u0600-\u06FF]+/g) ?? []));
  assert.deepEqual(leaks, [], `Arabic script in the English interface: ${leaks.join(" ")}`);
  await ctx.close();
});

test("FAKE live provider + FAKE retriever: verified quote shown with source link; verdict contradicted", async () => {
  const analysis = {
    understood: { claimRestated: "The Sun orbits the Earth.", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [{ id: "c1", text: "The Sun orbits the Earth.", type: "factual", evidence: [{ sourceId: "S1", stance: "contradicts", quote: "The Earth orbits the Sun once every" }], missingEvidence: "Textbook.", backgroundNote: null }],
    caveats: [],
  };
  const fc = fakeClient([okResponse(analysis, "claude-opus-5-5")]);
  const retriever: SourceRetriever = { name: "fake-test-retriever", enabled: true, search: async () => [fakeSource({ excerpt: "The Earth orbits the Sun once every 365.25 days." })] };
  const base = await startApp({ evidenceProvider: new AnthropicEvidenceProvider({ client: fc.client, model: "claude-opus-5-5" }), retriever });
  const { page, problems, ctx } = await analyzePage(base, "The Sun orbits the Earth");
  await page.waitForSelector("#e-basis");
  assert.equal(await page.getAttribute("#e-basis", "data-basis"), "retrieved_sources");
  assert.equal(await page.locator("#e-overall [data-verdict]").getAttribute("data-verdict"), "contradicted");
  assert.equal(await page.locator("[data-stance='contradicts']").count(), 1);
  const link = page.locator("[data-stance='contradicts'] a");
  assert.equal(await link.getAttribute("href"), "https://example.org/fake-test-source");
  assert.match(String(await link.getAttribute("rel")), /noopener/);
  assert.ok((await page.locator('#e-result [data-provenance="ai"]').count()) >= 1);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("mobile: evidence panel without horizontal overflow", async () => {
  const { page, problems, ctx } = await analyzePage(demoBase, "Water boils at 100 degrees everywhere", { width: 390, height: 844 });
  await page.waitForSelector("#e-overall");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/evidence-mobile.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});
