import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain browser ES module, tested directly in Node.
import * as CSModule from "../../public/js/cards-store.js";
// Plain JS module: typed loosely here; the module validates its own inputs at runtime.
const CS: any = CSModule;

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
let seq = 0;
const ids = () => `card-test-${String(++seq).padStart(4, "0")}`;
const store = (s = memoryStorage(), t = 1_800_000_000_000) => ({ s, cs: CS.createCardStore(s, { now: () => t, newId: ids }) });

const demoResponse = {
  answer: { title: "التركيب الضوئي", summary: "ملخص", keyConcepts: ["اليخضور"], segments: [{ kind: "fact", text: "x", sourceIds: [] }] },
  sources: [],
  verification: { status: "demo" },
  meta: { simulated: true, model: null },
};
const liveSourced = {
  answer: { title: "T", summary: "S", keyConcepts: [], segments: [{ kind: "fact", text: "x", sourceIds: ["S1"] }] },
  sources: [
    { id: "S1", title: "FAKE TEST SOURCE", url: "https://example.org/a", publisher: "p", publishedAt: null, retrievedAt: "2026-11-20T00:00:00Z" },
    { id: "S2", title: "Uncited", url: "https://example.org/b", publisher: null, publishedAt: null, retrievedAt: "x" },
  ],
  verification: { status: "source_backed" },
  meta: { simulated: false, model: "claude-sonnet-5-5" },
};

test("card from a demo answer: status demo, no sources, origin demo", () => {
  const c = CS.cardFromAnswer(demoResponse, "darija", "علوم");
  assert.equal(c.verificationStatus, "demo");
  assert.equal(c.origin, "demo");
  assert.deepEqual(c.sources, []);
});

test("card from a live un-sourced answer: not_source_verified", () => {
  const c = CS.cardFromAnswer({ ...liveSourced, verification: { status: "not_source_verified" }, sources: [] }, "fr", "x");
  assert.equal(c.verificationStatus, "not_source_verified");
  assert.equal(c.origin, "ai");
});

test("card from a source-backed answer keeps ONLY cited sources", () => {
  const c = CS.cardFromAnswer(liveSourced, "en", "x");
  assert.equal(c.verificationStatus, "sources_attached");
  assert.deepEqual(c.sources.map((s: any) => s.url), ["https://example.org/a"]);
});

test("add / list / search / collections / update / remove", () => {
  const { cs } = store();
  const a = cs.add(CS.cardFromAnswer(demoResponse, "darija", "علوم"));
  assert.equal(a.ok, true);
  cs.add({ ...CS.cardFromAnswer(demoResponse, "darija", "رياضيات"), title: "فيثاغورس", summary: "مثلث قائم" });
  assert.equal(cs.count(), 2);
  assert.deepEqual(cs.collections(), ["رياضيات", "علوم"]);
  assert.equal(cs.list({ collection: "علوم" }).length, 1);
  assert.equal(cs.list({ search: "مثلث" }).length, 1);
  assert.equal(cs.list({ search: "اليخضور" }).length, 2, "search covers key concepts");
  const u = cs.update(a.card.id, { title: "عنوان جديد", collection: "بيولوجيا" });
  assert.equal(u.card.title, "عنوان جديد");
  assert.equal(cs.remove(a.card.id).ok, true);
  assert.equal(cs.count(), 1);
  assert.equal(cs.remove("card-missing-0000").ok, false);
});

test("checkedByMe never upgrades the source status", () => {
  const { cs } = store();
  const a = cs.add(CS.cardFromAnswer({ ...liveSourced, verification: { status: "not_source_verified" }, sources: [] }, "fr", "x"));
  const u = cs.update(a.card.id, { checkedByMe: true, verificationStatus: "sources_attached" });
  assert.equal(u.card.checkedByMe, true);
  assert.equal(u.card.verificationStatus, "not_source_verified", "status cannot be patched");
});

test("tampered storage: invalid cards dropped, javascript: links removed, impossible statuses downgraded", () => {
  const s = memoryStorage();
  s.setItem(
    CS.CARDS_KEY,
    JSON.stringify({
      version: 1,
      cards: [
        { id: "card-ok-000001", title: "A", summary: "B", origin: "ai", verificationStatus: "sources_attached", sources: [{ title: "evil", url: "javascript:alert(1)" }] },
        { id: "card-ok-000002", title: "C", summary: "D", origin: "demo", verificationStatus: "sources_attached", sources: [{ title: "x", url: "https://example.org" }] },
        { id: "bad id!", title: "E", summary: "F" },
        { title: "no id" },
        "garbage",
      ],
    }),
  );
  const cards = CS.createCardStore(s).list();
  assert.equal(cards.length, 2);
  const a = cards.find((c: any) => c.id === "card-ok-000001");
  assert.deepEqual(a.sources, []);
  assert.equal(a.verificationStatus, "not_source_verified");
  const b = cards.find((c: any) => c.id === "card-ok-000002");
  assert.equal(b.verificationStatus, "demo");
  assert.deepEqual(b.sources, []);
});

test("corrupted JSON and wrong version reset safely", () => {
  const s = memoryStorage();
  s.setItem(CS.CARDS_KEY, "{not json");
  assert.deepEqual(CS.createCardStore(s).list(), []);
  s.setItem(CS.CARDS_KEY, JSON.stringify({ version: 9, cards: [] }));
  assert.deepEqual(CS.createCardStore(s).list(), []);
});

test("limit of 200 cards is enforced", () => {
  const { cs } = store();
  for (let i = 0; i < CS.MAX_CARDS; i++) assert.equal(cs.add({ title: `t${i}`, summary: "s", origin: "demo" }).ok, true);
  assert.deepEqual(cs.add({ title: "one more", summary: "s", origin: "demo" }), { ok: false, error: "limit" });
});

test("field lengths are capped and control/bidi characters removed", () => {
  const { cs } = store();
  const r = cs.add({ title: "x".repeat(500) + "‮", summary: "s\u0000", keyConcepts: Array(20).fill("k"), origin: "demo" });
  assert.equal(r.card.title.length, 160);
  assert.equal(r.card.summary, "s");
  assert.equal(r.card.keyConcepts.length, 8);
});

test("invalid input (no title) is refused; storage failure reported", () => {
  const { cs } = store();
  assert.deepEqual(cs.add({ summary: "s" }), { ok: false, error: "invalid" });
  const broken = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
  assert.deepEqual(CS.createCardStore(broken, { newId: ids }).add({ title: "t", summary: "s" }), { ok: false, error: "storage" });
});

test("export contains the cards and no secrets", () => {
  const { cs } = store();
  cs.add(CS.cardFromAnswer(demoResponse, "darija", "علوم"));
  const ex = JSON.parse(cs.exportJson());
  assert.equal(ex.app, "SCIORA");
  assert.equal(ex.cards.length, 1);
  assert.deepEqual(Object.keys(ex.cards[0]).sort(), ["checkedByMe", "collection", "createdAt", "id", "keyConcepts", "language", "model", "origin", "sources", "summary", "title", "updatedAt", "verificationStatus"]);
});
