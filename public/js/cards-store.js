/**
 * Knowledge cards — stored ONLY in this browser (localStorage). No server, no account.
 *
 * Verification status is copied from what SCIORA's server reported when the card was saved:
 *   "demo"                → pre-written demo content (never verified)
 *   "not_source_verified" → AI answer without retrieved sources
 *   "sources_attached"    → AI answer that cited sources the server actually retrieved
 * "checkedByMe" is a separate flag the student sets after checking the content themselves.
 * It never upgrades the source status.
 *
 * Limitations: localStorage is per browser/device, user-editable and visible to other users of
 * the same computer. Cards are personal notes, not an authoritative record. On load, every card
 * is re-validated (invalid cards are dropped, unsafe links removed, impossible statuses downgraded).
 */

export const CARDS_KEY = "sciora.cards.v1";
export const MAX_CARDS = 200;
export const CARD_STATUSES = ["demo", "not_source_verified", "sources_attached"];
const LANGS = ["darija", "msa", "fr", "en"];

const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, " ").trim().slice(0, max) : "");

export function isSafeHttpsUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

function cleanSources(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && isSafeHttpsUrl(s.url) && str(s.title, 300))
    .slice(0, 5)
    .map((s) => ({
      title: str(s.title, 300),
      url: new URL(s.url).toString(),
      publisher: str(s.publisher, 200) || null,
      publishedAt: str(s.publishedAt, 40) || null,
      retrievedAt: str(s.retrievedAt, 40) || null,
    }));
}

/** Validates/sanitizes a card. Returns null if it cannot be a valid card. */
export function normalizeCard(c) {
  if (!c || typeof c !== "object") return null;
  const id = str(c.id, 64);
  const title = str(c.title, 160);
  const summary = str(c.summary, 1200);
  if (!/^[a-z0-9-]{8,64}$/.test(id) || !title || !summary) return null;
  const origin = c.origin === "ai" ? "ai" : "demo";
  const sources = origin === "ai" ? cleanSources(c.sources) : [];
  let status = CARD_STATUSES.includes(c.verificationStatus) ? c.verificationStatus : "not_source_verified";
  if (origin === "demo") status = "demo";
  if (status === "sources_attached" && sources.length === 0) status = "not_source_verified";
  if (status === "demo" && origin === "ai") status = "not_source_verified";
  return {
    id,
    title,
    summary,
    keyConcepts: Array.isArray(c.keyConcepts) ? c.keyConcepts.map((k) => str(k, 80)).filter(Boolean).slice(0, 8) : [],
    language: LANGS.includes(c.language) ? c.language : "darija",
    sources,
    verificationStatus: status,
    checkedByMe: c.checkedByMe === true,
    origin,
    model: origin === "ai" ? str(c.model, 64) || null : null,
    collection: str(c.collection, 40) || "عام",
    createdAt: str(c.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: str(c.updatedAt, 40) || str(c.createdAt, 40) || new Date(0).toISOString(),
  };
}

/** Builds card input from a /api/knowledge/query response. */
export function cardFromAnswer(response, language, collection) {
  const simulated = !!response?.meta?.simulated;
  const status = simulated ? "demo" : response?.verification?.status === "source_backed" ? "sources_attached" : "not_source_verified";
  const citedIds = new Set((response?.answer?.segments ?? []).flatMap((s) => s.sourceIds ?? []));
  return {
    title: response?.answer?.title,
    summary: response?.answer?.summary,
    keyConcepts: response?.answer?.keyConcepts ?? [],
    language,
    sources: simulated ? [] : (response?.sources ?? []).filter((s) => citedIds.has(s.id)),
    verificationStatus: status,
    origin: simulated ? "demo" : "ai",
    model: response?.meta?.model ?? null,
    collection,
  };
}

function defaultId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "card-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createCardStore(storage, { now = () => Date.now(), newId = defaultId } = {}) {
  function load() {
    try {
      const raw = storage.getItem(CARDS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cards)) return [];
      return parsed.cards.map(normalizeCard).filter(Boolean).slice(0, MAX_CARDS);
    } catch {
      return [];
    }
  }
  function save(cards) {
    try {
      storage.setItem(CARDS_KEY, JSON.stringify({ version: 1, cards }));
      return true;
    } catch {
      return false; // storage full or disabled
    }
  }
  const iso = () => new Date(now()).toISOString();

  return {
    list({ collection = null, search = "" } = {}) {
      const q = String(search || "").trim().toLowerCase();
      return load()
        .filter((c) => !collection || c.collection === collection)
        .filter((c) => !q || [c.title, c.summary, ...c.keyConcepts].some((t) => t.toLowerCase().includes(q)))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    collections() {
      return [...new Set(load().map((c) => c.collection))].sort();
    },
    add(input) {
      const cards = load();
      if (cards.length >= MAX_CARDS) return { ok: false, error: "limit" };
      const t = iso();
      const card = normalizeCard({ ...input, id: newId(), checkedByMe: false, createdAt: t, updatedAt: t });
      if (!card) return { ok: false, error: "invalid" };
      cards.push(card);
      return save(cards) ? { ok: true, card } : { ok: false, error: "storage" };
    },
    update(id, patch) {
      const cards = load();
      const i = cards.findIndex((c) => c.id === id);
      if (i < 0) return { ok: false, error: "not_found" };
      const allowed = {};
      for (const k of ["title", "summary", "collection", "keyConcepts", "checkedByMe"]) if (k in patch) allowed[k] = patch[k];
      const next = normalizeCard({ ...cards[i], ...allowed, updatedAt: iso() });
      if (!next) return { ok: false, error: "invalid" };
      cards[i] = next;
      return save(cards) ? { ok: true, card: next } : { ok: false, error: "storage" };
    },
    remove(id) {
      const cards = load();
      const next = cards.filter((c) => c.id !== id);
      if (next.length === cards.length) return { ok: false, error: "not_found" };
      return save(next) ? { ok: true } : { ok: false, error: "storage" };
    },
    exportJson() {
      return JSON.stringify({ app: "SCIORA", kind: "knowledge-cards", version: 1, exportedAt: iso(), cards: load() }, null, 2);
    },
    count() {
      return load().length;
    },
    clear() {
      try {
        storage.removeItem(CARDS_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
