# SCIORA — Feature Status & Roadmap

_Last updated: 2026-11-20 (after Phase 1 implementation) · Deadline (reported from the WAICY 2026 Guidebook): 2026-11-29, 5:00 PM ET (to be re-verified on the official portal)._

Status labels used in this file:

| Label | Meaning |
|---|---|
| **Implemented & tested** | Code exists and its tests were actually executed and passed (see `TEST_REPORT.md`). |
| **In progress** | Being built now. Not ready for demonstration. |
| **Planned — Phase N** | Designed or listed, **not implemented**. Must not be presented as working. |
| **Awaiting approval** | Blocked on a decision by the project owner. |

> Current state (2026-11-20): **Phase 1 implemented; tested in demo mode and with a fake AI client.** Live AI mode has **not** been run against the real API (awaiting owner approval and key). Demo lessons and grading labels are **not yet reviewed** by the owner.

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

## Phase 2 — Planned features (NOT implemented)

| Priority | Feature | Status | Notes |
|---|---|---|---|
| P1 | Knowledge Explorer (Wikipedia retrieval, dated and linked sources, sourced facts separated from AI explanation) | **Planned — Phase 2** | Not built. Not shown in the Phase 1 interface. |
| P1 | Evidence Analyzer (Supported / Contradicted / Mixed Evidence / Insufficient Evidence) | **Planned — Phase 2** | Not built. Not shown in the Phase 1 interface. |
| P1 | Learning Progress screen | **Planned — Phase 2** | Built only from stored, real results. |
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
