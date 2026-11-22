import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES module, tested directly in Node.
import * as I18N from "../../public/js/i18n.js";
// @ts-ignore
import { NOTICE_CODES } from "../../src/notices.ts";
import { looksNonEnglish } from "../../src/domain/english-only.ts";

const I: any = I18N;

/** Every string in the dictionary, including the output of message functions. */
function allStrings(v: any, path = "$"): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (typeof v === "function") return [[path, String(v(1, 1, 1))]];
  if (Array.isArray(v)) return v.flatMap((x, i) => allStrings(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.keys(v).flatMap((k) => allStrings(v[k], `${path}.${k}`));
  return [];
}

test("English-only interface: one dictionary, English, left-to-right, no language switching API", () => {
  assert.deepEqual(I.UI_LANGUAGES, ["en"]);
  assert.deepEqual(Object.keys(I.DICTIONARIES), ["en"]);
  assert.equal(I.UI_LANG, "en");
  assert.equal(I.UI_DIR, "ltr");
  assert.equal(I.T, I.DICTIONARIES.en);
  for (const removed of ["setUiLanguage", "defaultContentLanguage", "DEFAULT_CONTENT_LANGUAGE", "demoTitle"]) assert.equal(I[removed], undefined, removed);
});

test("no language selectors or language names remain in the interface strings", () => {
  for (const key of ["languages", "languageLabel", "explanationDarija"]) assert.equal(I.T[key], undefined, key);
  assert.equal(I.T.k.languages, undefined);
  assert.equal(I.T.k.languageLabel, undefined);
  assert.equal(I.T.e.languageLabel, undefined);
  assert.equal(I.T.ui.interfaceNames, undefined);
  const mentions = allStrings(I.T).filter(([, s]) => /\b(Darija|Arabic|French|Arabizi|Moroccan)\b/i.test(s));
  assert.deepEqual(mentions, []);
});

test("every interface string is English: no Arabic script and nothing the English-only check would reject", () => {
  const all = allStrings(I.T);
  assert.ok(all.length > 150);
  assert.deepEqual(all.filter(([, s]) => /[؀-ۿ]/.test(s)).map(([p]) => p), []);
  assert.deepEqual(all.filter(([, s]) => looksNonEnglish(s)).map(([p]) => p), []);
});

test("every server notice code has an English message", () => {
  for (const code of NOTICE_CODES) assert.ok(I.T.notices[code], code);
  assert.equal((NOTICE_CODES as readonly string[]).includes("demo_language_fixed"), false, "no language-mismatch notice in an English-only product");
});

test("the English-only notice is the exact required sentence", () => {
  assert.equal(I.T.errorCodes.english_only, "SCIORA currently supports English only. Please submit your question in English to continue.");
});

test("live-mode banner names the provider and warns not to include personal information; demo banner does not", () => {
  assert.match(I.T.modeLive("Groq"), /Live AI \(Groq\)/);
  assert.match(I.T.modeLive("Claude"), /Claude/);
  assert.match(I.T.modeLive("Groq"), /sent to Groq/);
  assert.match(I.T.modeLive("Groq"), /personal information/);
  assert.doesNotMatch(I.T.modeDemo, /sent to/);
});
