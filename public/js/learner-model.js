/**
 * SCIORA learner model — PRELIMINARY LEVEL ESTIMATE (not proof of mastery).
 *
 * An Elo-style rating per topic, updated ONLY from real graded answers in SCIORA.
 * "uncertain" results are ignored. Stored in the browser's localStorage.
 *
 * localStorage limitations (documented in PROJECT_ARCHITECTURE.md / AI_ETHICS.md):
 *  - one browser on one device; nothing syncs; a new device starts from zero
 *  - deleted by clearing browser data or by private browsing
 *  - editable by the user, so it is NOT trustworthy for certification or official records
 *  - visible to the next person on a shared computer ("Clear my data" button provided)
 * The server never trusts this value for grading or security; it only adjusts explanations.
 */

export const STORAGE_KEY = "sciora.learner.v1";
export const START_RATING = 1000;
export const LOW_CONFIDENCE_BELOW = 5;

/** Difficulty assumed for an exercise generated at a given level. */
export const LEVEL_DIFFICULTY = { beginner: 900, school: 1000, intermediate: 1100, advanced: 1200 };

export function expectedScore(rating, difficulty) {
  return 1 / (1 + Math.pow(10, (difficulty - rating) / 400));
}

export function kFactor(n) {
  if (n < LOW_CONFIDENCE_BELOW) return 48;
  if (n < 15) return 32;
  return 16;
}

export function ratingToLevel(rating) {
  if (rating < 950) return "beginner";
  if (rating < 1050) return "school";
  if (rating < 1150) return "intermediate";
  return "advanced";
}

export function confidenceFor(n) {
  if (n < LOW_CONFIDENCE_BELOW) return "low";
  if (n < 15) return "medium";
  return "higher";
}

/** Outcome value from a grade result, or null if it must be ignored. */
export function outcomeValue(result) {
  if (!result || result.countsTowardEstimate !== true) return null;
  if (result.verdict === "correct") return 1;
  if (result.verdict === "incorrect") return 0;
  if (result.verdict === "partially_correct") return typeof result.score === "number" ? Math.min(1, Math.max(0, result.score)) : 0.5;
  return null; // uncertain or unknown
}

export function topicKey(topic) {
  return String(topic || "").trim().toLowerCase().slice(0, 120);
}

function emptyState() {
  return { version: 1, topics: {} };
}

export function createLearnerModel(storage, now = () => Date.now()) {
  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const s = JSON.parse(raw);
      if (!s || s.version !== 1 || typeof s.topics !== "object" || s.topics === null) return emptyState();
      return s;
    } catch {
      return emptyState(); // corrupted storage is reset safely
    }
  }
  function save(s) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage full or disabled: the estimate simply is not saved */
    }
  }

  return {
    /** Records one graded answer. Returns the updated estimate, or null if ignored. */
    record(topic, level, result) {
      const value = outcomeValue(result);
      if (value === null) return null;
      const key = topicKey(topic);
      if (!key) return null;
      const s = load();
      const t = s.topics[key] || { label: String(topic).slice(0, 120), rating: START_RATING, n: 0, counts: { correct: 0, partially_correct: 0, incorrect: 0 } };
      const difficulty = LEVEL_DIFFICULTY[level] ?? LEVEL_DIFFICULTY.school;
      const rating = Number.isFinite(t.rating) ? t.rating : START_RATING;
      const n = Number.isFinite(t.n) ? t.n : 0;
      t.rating = Math.round(rating + kFactor(n) * (value - expectedScore(rating, difficulty)));
      t.n = n + 1;
      t.counts = t.counts || { correct: 0, partially_correct: 0, incorrect: 0 };
      if (t.counts[result.verdict] !== undefined) t.counts[result.verdict]++;
      t.updatedAt = new Date(now()).toISOString();
      s.topics[key] = t;
      save(s);
      return this.estimate(topic);
    },

    /** Preliminary estimate for a topic, or null if no graded answers yet. */
    estimate(topic) {
      const t = load().topics[topicKey(topic)];
      if (!t || !t.n) return null;
      return {
        topic: t.label,
        estimatedLevel: ratingToLevel(t.rating),
        basedOnAnswers: t.n,
        confidence: confidenceFor(t.n),
        counts: { ...t.counts },
        isPreliminary: true,
      };
    },

    allTopics() {
      return Object.values(load().topics).map((t) => this.estimate(t.label)).filter(Boolean);
    },

    clear() {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
