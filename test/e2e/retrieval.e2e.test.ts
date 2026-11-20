import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../../src/app.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { WikipediaRetriever } from "../../src/knowledge/wikipedia-retriever.ts";
import { testConfig } from "../helpers/app.ts";

/**
 * Retrieval UI with the REAL WikipediaRetriever code and a FAKE fetch (no network).
 * Demo mode: retrieved articles are related reading only — never citations or evidence.
 */
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SHOTS = process.env.SCIORA_SCREENSHOT_DIR;
let browser: any;
let app: any;
let base = "";

const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  const wiki = u.hostname.split(".")[0];
  return new Response(
    JSON.stringify({
      query: {
        pages: [
          {
            ns: 0,
            title: "Water cycle (TEST FIXTURE)",
            index: 1,
            fullurl: `https://${wiki}.wikipedia.org/wiki/Water_cycle`,
            extract: "The water cycle describes the continuous movement of water on, above and below the surface of the Earth.",
            revisions: [{ timestamp: "2026-10-30T08:00:00Z" }],
          },
        ],
      },
    }),
    { status: 200 },
  );
}) as unknown as typeof fetch;

before(async () => {
  const retriever = new WikipediaRetriever({ userAgent: "SCIORA-Test/1.0", fetchFn: fakeFetch, minIntervalMs: 0 });
  ({ app } = await buildApp({ config: testConfig(), provider: new DemoProvider(), retriever }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test("health reports Wikipedia retrieval enabled; 'real_source_retrieval' no longer planned", async () => {
  const b = (await app.inject({ url: "/api/health" })).json();
  assert.equal(b.knowledge.sourceRetrieval, true);
  assert.equal(b.knowledge.retriever, "wikipedia");
  assert.equal(b.plannedNotImplemented.includes("real_source_retrieval"), false);
});

test("Explorer demo: Wikipedia article shown as related reading with real metadata; status stays demo", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("console", (m: any) => m.type() === "error" && problems.push(m.text()));
  await page.goto(base + "/");
  await page.click("#tab-explore");
  await page.fill("#k-question", "What is the water cycle?");
  await page.click("#k-ask");
  await page.waitForSelector("#k-verification");
  assert.equal(await page.getAttribute("#k-verification", "data-status"), "demo");
  assert.equal(await page.locator("#k-related-help").count(), 1);
  const link = page.locator("#k-src-S1 a");
  assert.equal(await link.getAttribute("href"), "https://en.wikipedia.org/wiki/Water_cycle");
  assert.match(String(await link.getAttribute("rel")), /noopener/);
  const meta = await page.textContent("#k-src-S1 .source-meta");
  assert.match(meta!, /Wikipedia \(en\)/);
  assert.match(meta!, /Last edited: 2026-10-30/);
  assert.doesNotMatch(meta!, /Published/i, "no invented publication date");
  assert.match(await page.textContent("#k-result"), /not sufficient proof on its own/);
  assert.equal(await page.locator('[data-notice="related_reading_only"]').count(), 1);
  assert.equal(await page.locator("#k-result .segment-refs").count(), 0, "pre-written segments never cite sources");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/retrieval-explorer.png`, fullPage: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("Evidence demo: related sources listed separately; verdict remains insufficient evidence", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.click("#tab-evidence");
  await page.fill("#e-claim", "Water boils at 100 degrees everywhere");
  await page.click("#e-analyze");
  await page.waitForSelector("#e-overall");
  assert.equal(await page.locator("#e-overall [data-verdict]").getAttribute("data-verdict"), "insufficient_evidence");
  assert.equal(await page.locator("#e-related li").count(), 1);
  assert.match(await page.textContent("#e-related"), /not evidence for this verdict/);
  assert.equal(await page.locator("[data-stance]").count(), 0, "no evidence items in demo");
  await ctx.close();
});
