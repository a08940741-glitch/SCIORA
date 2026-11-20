# SCIORA — Feature Status & Roadmap

_Last updated: 2026-11-20 (after Phase 2B — Evidence Analyzer) · Deadline (reported from the WAICY 2026 Guidebook): 2026-11-29, 5:00 PM ET (to be re-verified on the official portal)._

Status labels used in this file:

| Label | Meaning |
|---|---|
| **Implemented & tested** | Code exists and its tests were actually executed and passed (see `TEST_REPORT.md`). |
| **In progress** | Being built now. Not ready for demonstration. |
| **Planned — Phase N** | Designed or listed, **not implemented**. Must not be presented as working. |
| **Awaiting approval** | Blocked on a decision by the project owner. |

> Current state (2026-11-20): **Phase 1, Phase 2A (Knowledge Explorer) and Phase 2B (Evidence Analyzer) implemented; tested in demo mode and with a fake AI client / fake retriever.** No real source retrieval exists (decision D1). Live AI mode has **not** been run against the real API (awaiting owner approval and key). Demo lessons and grading labels are **not yet reviewed** by the owner.

---

## Phase 1 — Core learning loop

Scope: Question → Understanding → Explanation (Darija + formal) → Example → Exercises → Grading → Feedback.

| Feature | Status |
|---|---|
| Fastify + TypeScript server, zod validation, security headers (CSP), rate limiting, body limit | **Implemented & tested** |
| `DemoProvider`: 5 pre-written lessons, labelled simulated, honest "not in demo" message | **Implemented & tested** (content unreviewed) |
| `AnthropicProvider`: structured outputs, refusal / cut-off / invalid-output handling, error mapping | **Implemented & tested with a fake client only** — not yet run against the live API |
| Model routing: Sonnet 5.5 (lessons), Haiku 5.5 (grading), Opus 5.5 (reserved) — configurable | **Implemented & tested** (routing verified with fake client) |
| Server-side refusal fallback (`fallbacks: "default"`) | **Implemented, unverified live** |
| AES-256-GCM encrypted exercise tokens with expiry and key id | **Implemented & tested** |
| Replay store: atomic reservation, original result on repeat, fail-closed capacity, answer lock after failure | **Implemented & tested** (in-memory; single process) |
| Rule-based grading: MCQ, numeric (Arabic numerals, fractions, percent, units), algebraic expressions | **Implemented & tested** |
| Rubric-based written grading with evidence check and server-side verdict (correct / partial / incorrect / uncertain) | **Implemented & tested offline**; real Haiku behaviour **untested** |
| Optional escalation of uncertain grades to the LEARN model | **Implemented & tested** (fake provider) |
| Daily AI-call limit (live mode) | **Implemented & tested** |
| Arabic RTL workspace with per-card "AI-generated" / "DEMO" labels, hints, solutions, one attempt per exercise | **Implemented & tested** (Playwright, desktop + mobile) |
| Preliminary level estimate (Elo-style, localStorage, uncertain ignored, Clear my data) | **Implemented & tested** |
| Responsible-use notes in the interface | **Implemented** (short panel; full page planned) |
| Grading fixtures: 37 cases (Darija, MSA, paraphrase, Arabizi/French, misspelled, maths, partial, incorrect, unclear) | **Implemented** — labels **unreviewed** |
| Live smoke test and grading evaluation scripts | **Written, gated, NOT run** (require owner approval) |
| 8 project documents | **Written** |

Phase 1 explicitly does **not** include: accounts or authentication, a database, Knowledge Explorer, Evidence Analyzer, a Progress screen, or a French interface.

---

## Phase 2A — Knowledge Explorer

| Feature | Status |
|---|---|
| Knowledge query (Darija / MSA / French / English / Arabizi questions; answer in darija, msa, fr or en; 3 levels) | **Implemented & tested** (demo; live provider with fake client only) |
| Answer segments labelled fact / explanation / assumption / uncertainty | **Implemented & tested** |
| Source transparency: AI cannot output titles/URLs; only server-retrieved source ids; invented citations removed and disclosed | **Implemented & tested** |
| Verification status decided by the server: demo / not_source_verified / source_backed | **Implemented & tested** |
| `SourceRetriever` interface + `NoopRetriever` | **Implemented & tested** |
| **Real source retrieval** (Wikipedia, web search, …) | **Not implemented** (decision D1). Live answers are always labelled *not source-verified*. |
| Source sanitizing (https only, no credentials, control/bidi chars removed, caps, server ids) | **Implemented & tested** |
| Retrieval timeout / failure handling | **Implemented & tested** (fake retriever) |
| Topic connections (deduped, max 5, always labelled suggestions) | **Implemented & tested** |
| Learning mode: simplify / examples / self-check quiz (independent of Phase 1 grading) | **Implemented & tested** |
| Knowledge cards: save, collections, search, "checked by me", move, delete, export (browser-only) | **Implemented & tested** |
| API: `POST /api/knowledge/query`, `POST /api/knowledge/transform` (shared daily limit, rate limit, CSP) | **Implemented & tested** |
| UI: tabs (learning / explorer / cards), Arabic RTL, mobile, no English leakage in interface text | **Implemented & tested** (Playwright) |
| Demo knowledge content (5 topics, no sources) | **Implemented** — **unreviewed** |

## Phase 2B — Evidence Analyzer

| Feature | Status |
|---|---|
| Claim input in Darija / MSA / French / English / Arabizi; analysis language darija, msa, fr, en | **Implemented & tested** (demo; live provider with fake client only, REASON tier) |
| Claim split into up to 6 sub-claims, classified factual / opinion / prediction / value judgment / ambiguous | **Implemented & tested** (server re-assigns ids) |
| Evidence items must quote a server-retrieved source excerpt (verified by the server); others removed and disclosed | **Implemented & tested** |
| Server-side verdicts: Supported / Contradicted / Mixed / Insufficient Evidence / Not checkable | **Implemented & tested** |
| Missing-evidence guidance per sub-claim | **Implemented & tested** |
| AI background note, displayed separately as "not evidence", never affects verdicts | **Implemented & tested** |
| `POST /api/evidence/analyze` (shared daily limit, rate limit, CSP) | **Implemented & tested** |
| Evidence tab (Arabic RTL, mobile, no English leakage) | **Implemented & tested** (Playwright) |
| Demo analyses (5 claims, no sources/evidence) | **Implemented** — **unreviewed** |
| Real evidence retrieval | **Not implemented** (D1) — factual claims receive *Insufficient Evidence* outside tests |

## Learning Progress (adaptive learning, module 6)

| Feature | Status |
|---|---|
| Progress tab: topics studied, graded answers, correct answers, saved cards (browser data only) | **Implemented & tested** |
| Per-topic preliminary estimate with correct / partial / incorrect counts | **Implemented & tested** |
| Explainable recommendations (review / practice more / next level / keep) + practice shortcut | **Implemented & tested** |
| Server-side or synced progress | **Not implemented** (would require accounts — see optional Google Sign-In, Phase 2 planned) |

## International interface & real retrieval

| Feature | Status |
|---|---|
| English default interface (LTR), international landing section, interface-language switcher | **Implemented & tested** |
| Optional Arabic (Darija) interface (RTL), identical keys to English (unit-tested) | **Implemented & tested** |
| Interface language independent from learning / AI response language | **Implemented & tested** |
| Server system notices as neutral codes translated by the interface | **Implemented & tested** |
| Wikipedia retrieval (free MediaWiki API) for Knowledge Explorer and Evidence Analyzer | **Implemented & tested** (fake fetch); **real API checked manually** (English OK; Arabic rate-limited from this cloud address) |
| Rate limiting, cache, bounded retries with backoff, timeout/abort, per-wiki fallback | **Implemented & tested** |
| Real source metadata (URL, excerpt, last edited, retrieved); no invented publication dates | **Implemented & tested** |
| Wikipedia-only notice; demo related reading never used as citations/evidence | **Implemented & tested** |
| French interface | **Not implemented** |

## Phase 2 — Remaining planned features (NOT implemented)

| Priority | Feature | Status | Notes |
|---|---|---|---|
| P1 | Landing page, Settings, full Responsible-AI / limitations page, French interface | **Planned — Phase 2** | Phase 1 has a short responsible-use panel only. |
| P2 | **Optional Google Sign-In + progress sync** | **Planned — Phase 2** | Full design: [`docs/planned/GOOGLE_SIGN_IN.md`](docs/planned/GOOGLE_SIGN_IN.md). Requires a database and an owner decision on hosting. |
| P2 | Persistent replay store (SQLite) | **Planned — Phase 2** | Would remove the Phase 1 "server restart" replay limitation. Shares the database introduced for sign-in. |
| P3 | Photo input of a homework question (Perception) | **Planned — stretch** | Only if time allows. |

### Optional Google Sign-In — summary

- **Status:** Planned — Phase 2. **Not implemented in Phase 1.** Phase 1 architecture is unchanged and has no database.
- **Optional:** SCIORA stays fully usable without an account; anonymous progress stays in the browser.
- **Method:** Google Identity Services (Sign in with Google), ID token verified on the server.
- **Scopes:** `openid`, `email`, `profile` only. No Gmail, Google Drive, or any other Google API access.
- **Includes:** account-based progress sync, secure sessions, logout, and account deletion.
- **Minors:** designed as if every user may be under 18 (data minimisation, no tracking, guardian notice, easy deletion). Legal requirements must be verified before launch.
- **Deadline risk:** sign-in needs a database, persistent hosting and a Google Cloud setup. It is scheduled **after** Knowledge Explorer and Evidence Analyzer. If time runs short before 2026-11-29, it remains a documented roadmap item and is presented to judges as planned, not as working.
