import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES module, tested directly in Node.
import * as LM from "../../public/js/learner-model.js";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}
const r = (verdict: string, score: number | null = null, counts = verdict !== "uncertain") => ({ verdict, score, countsTowardEstimate: counts });

test("no estimate before any graded answer", () => {
  const lm = LM.createLearnerModel(memoryStorage());
  assert.equal(lm.estimate("التركيب الضوئي"), null);
});

test("estimate is preliminary and low-confidence below 5 answers", () => {
  const lm = LM.createLearnerModel(memoryStorage());
  for (let i = 0; i < 4; i++) lm.record("Topic", "school", r("correct", 1));
  const e = lm.estimate("Topic")!;
  assert.equal(e.isPreliminary, true);
  assert.equal(e.basedOnAnswers, 4);
  assert.equal(e.confidence, "low");
  lm.record("Topic", "school", r("correct", 1));
  assert.equal(lm.estimate("Topic")!.confidence, "medium");
});

test("uncertain results are ignored (never change the estimate)", () => {
  const s = memoryStorage();
  const lm = LM.createLearnerModel(s);
  assert.equal(lm.record("Topic", "school", r("uncertain", null, false)), null);
  assert.equal(lm.estimate("Topic"), null);
  lm.record("Topic", "school", r("correct", 1));
  const before = JSON.stringify(lm.estimate("Topic"));
  lm.record("Topic", "school", r("uncertain", null, false));
  assert.equal(JSON.stringify(lm.estimate("Topic")), before);
});

test("results flagged countsTowardEstimate=false are ignored even if 'incorrect'", () => {
  const lm = LM.createLearnerModel(memoryStorage());
  assert.equal(lm.record("Topic", "school", { verdict: "incorrect", score: 0, countsTowardEstimate: false }), null);
});

test("Elo maths: correct raises, incorrect lowers, partial in between", () => {
  assert.equal(LM.expectedScore(1000, 1000), 0.5);
  const up = LM.createLearnerModel(memoryStorage());
  up.record("T", "school", r("correct", 1));
  const down = LM.createLearnerModel(memoryStorage());
  down.record("T", "school", r("incorrect", 0));
  const s1 = memoryStorage();
  const mid = LM.createLearnerModel(s1);
  mid.record("T", "school", r("partially_correct", 0.5));
  const rating = (s: ReturnType<typeof memoryStorage>) => JSON.parse(s.raw.get(LM.STORAGE_KEY)!).topics.t.rating;
  assert.equal(rating(s1), 1000, "0.5 at expected 0.5 → no change");
  // K=48 at n=0: correct → 1000 + 48*0.5 = 1024
  const s2 = memoryStorage();
  LM.createLearnerModel(s2).record("T", "school", r("correct", 1));
  assert.equal(rating(s2), 1024);
});

test("harder level counts more for a correct answer", () => {
  const a = memoryStorage();
  LM.createLearnerModel(a).record("T", "advanced", r("correct", 1));
  const b = memoryStorage();
  LM.createLearnerModel(b).record("T", "beginner", r("correct", 1));
  const ra = JSON.parse(a.raw.get(LM.STORAGE_KEY)!).topics.t.rating;
  const rb = JSON.parse(b.raw.get(LM.STORAGE_KEY)!).topics.t.rating;
  assert.ok(ra > rb);
});

test("rating maps to the four levels", () => {
  assert.equal(LM.ratingToLevel(900), "beginner");
  assert.equal(LM.ratingToLevel(1000), "school");
  assert.equal(LM.ratingToLevel(1100), "intermediate");
  assert.equal(LM.ratingToLevel(1200), "advanced");
});

test("corrupted storage is reset safely; clear() removes data", () => {
  const s = memoryStorage();
  s.setItem(LM.STORAGE_KEY, "{not json");
  const lm = LM.createLearnerModel(s);
  assert.equal(lm.estimate("T"), null);
  lm.record("T", "school", r("correct", 1));
  assert.ok(lm.estimate("T"));
  lm.clear();
  assert.equal(s.getItem(LM.STORAGE_KEY), null);
  assert.equal(lm.estimate("T"), null);
});

test("storage failures do not crash (e.g. storage disabled)", () => {
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  const lm = LM.createLearnerModel(broken);
  assert.doesNotThrow(() => lm.record("T", "school", r("correct", 1)));
  assert.doesNotThrow(() => lm.clear());
});

test("no personal data is stored: only topic label, rating, counts, timestamp", () => {
  const s = memoryStorage();
  LM.createLearnerModel(s).record("Topic", "school", r("correct", 1));
  const stored = JSON.parse(s.raw.get(LM.STORAGE_KEY)!);
  assert.deepEqual(Object.keys(stored.topics.topic).sort(), ["counts", "label", "n", "rating", "updatedAt"]);
});
