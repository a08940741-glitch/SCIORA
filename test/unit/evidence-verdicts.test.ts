import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvidence, overallVerdict, quoteInSource, subClaimVerdict } from "../../src/evidence/verdicts.ts";
import { EvidenceRequest, GeneratedClaimAnalysis } from "../../src/evidence/schemas.ts";
import { sanitizeSources } from "../../src/knowledge/sources.ts";
import { fakeSource } from "../helpers/knowledge.ts";

const T = "2026-11-20T00:00:00.000Z";
const SOURCES = sanitizeSources(
  [
    fakeSource({ excerpt: "The Earth orbits the Sun once every 365.25 days approximately." }),
    fakeSource({ url: "https://example.org/2", excerpt: "تدور الأرض حول الشمس مرة واحدة كل سنة تقريبا." }),
  ],
  T,
  "fake",
);

// ---------------------------------------------------------------- schemas

test("request: limits, default language, strict", () => {
  assert.equal(EvidenceRequest.parse({ claim: "  The Earth orbits the Sun " }).language, "en");
  for (const bad of [{}, { claim: "abc" }, { claim: "x".repeat(1001) }, { claim: "valid claim", language: "de" }, { claim: "valid claim", language: "darija" }, { claim: "valid claim", x: 1 }]) {
    assert.equal(EvidenceRequest.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 30));
  }
});

test("AI output cannot carry URLs, titles or a verdict field", () => {
  const base = {
    understood: { claimRestated: "c", detectedLanguage: "en", isAnalyzable: true, clarification: null },
    subClaims: [{ id: "c1", text: "t", type: "factual", evidence: [{ sourceId: "https://evil.example", stance: "supports", quote: "q" }], missingEvidence: "m", backgroundNote: null }],
    caveats: [],
  };
  assert.equal(GeneratedClaimAnalysis.safeParse(base).success, false, "URL as source id rejected");
  const ok = structuredClone(base) as any;
  ok.subClaims[0].evidence = [];
  ok.subClaims[0].verdict = "supported"; // AI tries to set the verdict
  ok.verdict = "supported";
  const parsed = GeneratedClaimAnalysis.parse(ok) as any;
  assert.equal("verdict" in parsed, false);
  assert.equal("verdict" in parsed.subClaims[0], false, "AI-proposed verdicts are stripped");
  const badStance = structuredClone(ok) as any;
  badStance.subClaims[0].evidence = [{ sourceId: "S1", stance: "proves", quote: "q" }];
  assert.equal(GeneratedClaimAnalysis.safeParse(badStance).success, false);
});

// ---------------------------------------------------------------- evidence check

test("quote must appear in the cited source's excerpt (normalized)", () => {
  assert.equal(quoteInSource("The Earth orbits the Sun", SOURCES[0]!), true);
  assert.equal(quoteInSource("the earth  ORBITS the sun.", SOURCES[0]!), true);
  assert.equal(quoteInSource("تدور الأرض حول الشمس", SOURCES[1]!), true);
  assert.equal(quoteInSource("The Sun orbits the Earth", SOURCES[0]!), false, "fabricated quote");
  assert.equal(quoteInSource("Earth", SOURCES[0]!), false, "too short to count");
});

test("evidence with unknown source id, fabricated quote, or duplicate is removed and counted", () => {
  const { kept, removed } = checkEvidence(
    [
      { sourceId: "S1", stance: "supports", quote: "The Earth orbits the Sun" },
      { sourceId: "S1", stance: "supports", quote: "The Earth orbits the Sun" }, // duplicate
      { sourceId: "S9", stance: "supports", quote: "The Earth orbits the Sun" }, // not retrieved
      { sourceId: "S2", stance: "contradicts", quote: "The Moon is made of cheese" }, // not in S2
    ],
    SOURCES,
  );
  assert.equal(kept.length, 1);
  assert.equal(removed, 3);
});

test("no retrieved sources → every evidence item is removed", () => {
  const { kept, removed } = checkEvidence([{ sourceId: "S1", stance: "supports", quote: "The Earth orbits the Sun" }], []);
  assert.equal(kept.length, 0);
  assert.equal(removed, 1);
});

// ---------------------------------------------------------------- verdicts

const sup = { sourceId: "S1", stance: "supports" as const, quote: "q" };
const con = { sourceId: "S2", stance: "contradicts" as const, quote: "q" };
const ctx = { sourceId: "S1", stance: "context" as const, quote: "q" };

test("sub-claim verdicts from verified evidence only", () => {
  assert.equal(subClaimVerdict("factual", []), "insufficient_evidence");
  assert.equal(subClaimVerdict("factual", [ctx]), "insufficient_evidence", "context alone decides nothing");
  assert.equal(subClaimVerdict("factual", [sup]), "supported");
  assert.equal(subClaimVerdict("factual", [con]), "contradicted");
  assert.equal(subClaimVerdict("factual", [sup, con]), "mixed");
});

test("opinions, predictions, value judgments and ambiguous claims are not checkable (even with 'evidence')", () => {
  for (const t of ["opinion", "prediction", "value_judgment", "ambiguous"] as const) {
    assert.equal(subClaimVerdict(t, [sup]), "not_checkable", t);
  }
});

test("overall verdict rules", () => {
  const v = (...xs: string[]) => overallVerdict(xs.map((verdict) => ({ verdict: verdict as any })));
  assert.equal(v("not_checkable"), "not_checkable");
  assert.equal(v("supported", "supported"), "supported");
  assert.equal(v("contradicted"), "contradicted");
  assert.equal(v("supported", "contradicted"), "mixed");
  assert.equal(v("mixed", "supported"), "mixed");
  // Requested refinement: a claim with some supported parts and no contradictions is "partially supported",
  // which is more informative than "insufficient" and still never claims the whole claim is verified.
  assert.equal(v("supported", "insufficient_evidence"), "partially_supported");
  assert.equal(v("supported", "insufficient_evidence", "not_checkable"), "partially_supported");
  assert.equal(v("contradicted", "insufficient_evidence"), "insufficient_evidence", "a contradiction alone with gaps is not 'partial support'");
  assert.equal(v("supported", "not_checkable"), "supported", "opinion parts are excluded");
  assert.equal(v("insufficient_evidence", "not_checkable"), "insufficient_evidence");
});
