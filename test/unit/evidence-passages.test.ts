import { test } from "node:test";
import assert from "node:assert/strict";
import { keyTerms, relevantPassages, splitSentences } from "../../src/evidence/passages.ts";
import { sanitizeSources } from "../../src/knowledge/sources.ts";
import { EvidenceService } from "../../src/evidence/service.ts";
import { DemoEvidenceProvider } from "../../src/evidence/provider.ts";
import type { SourceRetriever } from "../../src/knowledge/retriever.ts";
import { fakeSource } from "../helpers/knowledge.ts";

const SOURCES = sanitizeSources(
  [
    fakeSource({ excerpt: "Water is a chemical substance. At sea level, pure water boils at 100 degrees Celsius. At high altitude the boiling point of water is lower because air pressure is lower." }),
    fakeSource({ url: "https://example.org/2", excerpt: "The Moon orbits the Earth. It has no atmosphere to speak of." }),
  ],
  "t",
  "fake",
);

test("key terms: normalized, English stopwords and short words removed", () => {
  const t = keyTerms("Water boils at 100 degrees everywhere");
  assert.ok(t.has("water") && t.has("boils") && t.has("degrees"));
  assert.equal(t.has("everywhere"), false);
  assert.equal(t.has("100"), false, "numbers are not key terms");
  assert.equal(keyTerms("The water and the heat").has("the"), false);
});

test("sentence splitting keeps meaningful sentences", () => {
  assert.equal(splitSentences("Short. This one is a longer sentence about water. ok").length, 1);
});

test("best matching sentence per source, ≥2 shared terms, matched terms reported", () => {
  const p = relevantPassages("Water boils at 100 degrees everywhere", SOURCES);
  assert.equal(p.length, 1);
  assert.equal(p[0]!.sourceId, "S1");
  assert.match(p[0]!.passage, /boils at 100 degrees/);
  assert.ok(p[0]!.matchedTerms.includes("boils"));
});

test("no overlap (or other language) → no passages; never invents text", () => {
  assert.deepEqual(relevantPassages("Pythagoras theorem triangles", SOURCES), []);
  assert.deepEqual(relevantPassages("الما كيغلي ف 100 درجة", SOURCES), [], "no cross-language matching");
  for (const p of relevantPassages("water boiling point pressure altitude", SOURCES)) {
    assert.ok(SOURCES.some((s) => s.excerpt.includes(p.passage)), "passage is verbatim from a source");
  }
});

test("service: passages are attached but never change the verdict (demo stays insufficient)", async () => {
  const retriever: SourceRetriever = { name: "wikipedia", enabled: true, search: async () => [fakeSource({ excerpt: "At sea level, pure water boils at 100 degrees Celsius under normal pressure conditions." })] };
  const r = await new EvidenceService({ provider: new DemoEvidenceProvider(), retriever }).analyze({ claim: "Water boils at 100 degrees everywhere", language: "en" });
  assert.equal(r.overall.verdict, "insufficient_evidence");
  assert.equal(r.basis.kind, "none");
  // Demo sub-claims are written in Darija, so literal matching against English text finds nothing — honestly.
  assert.ok(r.subClaims.every((s) => Array.isArray(s.relatedPassages)));
});
