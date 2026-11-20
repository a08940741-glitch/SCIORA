import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES module, tested directly in Node.
import * as I18N from "../../public/js/i18n.js";
// @ts-ignore
import { NOTICE_CODES } from "../../src/notices.ts";

const I: any = I18N;

function shape(v: unknown, path = "$"): string[] {
  if (typeof v === "function") return [`${path}:fn${(v as Function).length}`];
  if (Array.isArray(v)) return [`${path}:array${v.length}`];
  if (v && typeof v === "object") return Object.keys(v).sort().flatMap((k) => shape((v as any)[k], `${path}.${k}`));
  return [`${path}:${typeof v}`];
}

test("English is the default interface language (no stored preference)", () => {
  assert.equal(I.UI_LANG, "en");
  assert.equal(I.UI_DIR, "ltr");
  assert.equal(I.T, I.DICTIONARIES.en);
});

test("English and Arabic dictionaries have identical structure (no missing translations)", () => {
  assert.deepEqual(shape(I.DICTIONARIES.en), shape(I.DICTIONARIES.ar));
});

test("every server notice code has a translation in both interface languages", () => {
  for (const lang of I.UI_LANGUAGES) {
    for (const code of NOTICE_CODES) assert.ok(I.DICTIONARIES[lang].notices[code], `${lang}: ${code}`);
  }
});

test("English dictionary contains no Arabic script except deliberate bilingual examples", () => {
  const allowed = new Set(["$.ui.interfaceNames.ar", "$.askPlaceholder", "$.k.askPlaceholder", "$.e.claimPlaceholder"]);
  const walk = (v: any, path = "$"): string[] => {
    if (typeof v === "string") return /[؀-ۿ]/.test(v) && !allowed.has(path) ? [path] : [];
    if (typeof v === "function") {
      const out = String(v(1, 1, 1));
      return /[؀-ۿ]/.test(out) ? [path] : [];
    }
    if (v && typeof v === "object") return Object.keys(v).flatMap((k) => walk(v[k], `${path}.${k}`));
    return [];
  };
  assert.deepEqual(walk(I.DICTIONARIES.en), []);
});

test("setUiLanguage rejects unsupported languages", () => {
  assert.equal(I.setUiLanguage("de"), false);
});
