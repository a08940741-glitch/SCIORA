# SCIORA — Global Knowledge & Learning Intelligence

**WAICY 2026 · AI Showcase · Individual · Grade 7 · Morocco**

SCIORA is an AI-assisted learning platform for middle- and high-school students. It brings together three connected tools:

| Tool | What the student does | What SCIORA does |
|---|---|---|
| **Learning Assistant** | Asks about a school topic | Explains it (simple + formal explanation, steps, worked example), then gives 3 exercises and grades them with explained feedback |
| **Knowledge Explorer** | Asks any educational question | Answers with each part labelled *fact / explanation / assumption / uncertainty*, and says honestly whether the answer is backed by retrieved sources |
| **Evidence Analyzer** | Enters a claim they read or heard | Splits it into parts, separates checkable facts from opinions and predictions, and judges facts **only on quoted evidence from retrieved sources** |

Plus a **Progress** screen (a preliminary, per-topic level estimate kept only in the browser) and **Knowledge cards**.

**Language:** SCIORA is an English-only AI learning and knowledge platform designed for an international audience. The interface, lessons, exercises, feedback, knowledge answers and evidence analyses are all in English. A question, claim or written answer that is clearly in another language receives the notice “SCIORA currently supports English only. Please submit your question in English to continue.”

## Current AI status (honest summary)

| Mode | Status |
|---|---|
| **Demo mode** (default) | **Implemented and tested.** Pre-written English content for 5 topics and 5 claims, clearly labelled *DEMO — pre-written, not live AI*. No AI calls. |
| **Live AI with Anthropic Claude** | **Built, tested only with simulated (fake) API responses.** Never run against the real API. Paid service. |
| **Live AI with Groq** (free tier, open models) | **Built; first controlled live test passed (2026-11-21, English):** all four AI features completed and passed SCIORA's automatic checks. The free-tier rate limit was hit after 4 back-to-back calls. Live content not yet teacher-reviewed. |
| **Wikipedia retrieval** | **Implemented** (free public MediaWiki API, no key). In demo mode retrieved articles are shown only as *related reading*, never as proof. |
| Google Sign-In | **Planned, not implemented.** |

Details: [`FEATURE_STATUS.md`](FEATURE_STATUS.md) and [`TEST_REPORT.md`](TEST_REPORT.md).

## How SCIORA keeps AI honest

- **Rules before AI.** Multiple-choice, numeric and algebraic answers are graded by **deterministic rules** (`1/2 = 0.5 = ٠٫٥`, `2(x+1) = 2x+2`); the AI is never asked.
- **The server decides, not the AI.** For written answers the AI judges each rubric criterion, but the **server** computes the verdict and checks that every quote the AI gives really appears in the student's answer. Evidence verdicts are computed by the server from quotes it has checked in retrieved sources.
- **"Uncertain" is allowed.** When SCIORA is not sure, it says so, and uncertain results never count against the student.
- **No invented sources.** The AI may only cite sources the server retrieved; anything else is removed and the removal is disclosed.
- **Structured outputs + validation.** Every AI response must match a strict schema and is validated again on the server; invalid or cut-off output is rejected, never shown.
- **Labelled provenance.** Every result says whether it is *DEMO* or *AI-generated (model name)*.
- **Student text is data.** Questions, answers and claims are neutralized before entering a prompt so they cannot rewrite the AI's instructions.
- **English-only, enforced.** Every AI prompt requires English; clearly non-English input gets the English-only notice; AI output that is clearly not English is retried once, then rejected. (Heuristic checks: they cannot guarantee perfect English.)

## Run it

Requirements: Node.js 22+.

```bash
npm install
```

```bash
npm start
```

Open http://127.0.0.1:8787. Without configuration SCIORA runs in **demo mode**: pre-written lessons and knowledge answers on 5 topics (photosynthesis, the Pythagorean theorem, expanding/distributivity, the principle of inertia, the water cycle) and 5 example claims, with **no AI calls**. If the computer is online, related Wikipedia articles may be shown as *related reading* (free, no key); offline, demo mode still works and simply shows no related reading.

Configuration lives in environment variables; see [`.env.example`](.env.example). **Never commit `.env`.**

| Variable | Meaning |
|---|---|
| `SCIORA_AI_MODE` | `demo` (default) or `live`. Live mode also needs the selected provider's key. A key alone does **not** enable live mode. |
| `SCIORA_AI_PROVIDER` | Live provider: `anthropic` (default; paid; needs `ANTHROPIC_API_KEY`) or `groq` (free tier; needs `GROQ_API_KEY`). Only the selected provider's key is read. |
| `SCIORA_MODEL_LEARN` / `_FAST` / `_REASON` | Anthropic model routing (defaults: `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-opus-5-5`). |
| `SCIORA_GROQ_MODEL_LEARN` / `_FAST` / `_REASON` | Groq model routing (default for all three: `openai/gpt-oss-120b`, listed in Groq's docs as a production model with strict structured outputs). |
| `SCIORA_TOKEN_SECRET` | ≥ 32 random bytes; **required in production** (encrypts exercise answer keys). |
| `SCIORA_GRADE_ESCALATION` | `on` re-grades "uncertain" written answers once with the LEARN model (costs more). |
| `SCIORA_DAILY_LIMIT` | Max AI calls per day in live mode (0 = no limit). |
| `SCIORA_RETRIEVER` | `wikipedia` (default, free MediaWiki API) or `none`. |
| `SCIORA_WIKI_USER_AGENT` | User-Agent with contact info, as Wikimedia asks. Behind an HTTPS proxy, run Node with `NODE_USE_ENV_PROXY=1`. |

### Live AI setup

Step-by-step setup, the offline readiness check (`npm run live:check`) and the first controlled live test are in [`docs/LIVE_AI_SETUP.md`](docs/LIVE_AI_SETUP.md). Live AI with Groq has passed one first controlled test (English); Anthropic has not been run against a real API.

### About the Groq free tier

- Groq's terms require the **account holder to be 18 or older**, so a parent, guardian or teacher must create and own the account and key. The key is set only on the server (local `.env`, never committed) and is never sent to the browser.
- Free-tier limits (requests and tokens per minute and per day) are shown only in the Groq console and can change at any time. When a limit is reached Groq returns HTTP 429; SCIORA then shows "busy, try again" with the wait time and does **not** retry automatically.
- For any live session, set `SCIORA_DAILY_LIMIT` (e.g. `20`) and keep `SCIORA_RATE_LIMIT_PER_MINUTE` low so one user cannot use up the shared quota.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run typecheck
```

`npm run test:live` and `npm run eval:grading` make **real** API calls (billed with Anthropic; using the free-tier quota with Groq) and refuse to run unless `SCIORA_ALLOW_LIVE_TESTS=1`, `SCIORA_AI_MODE=live` and the selected provider's key are all set — and they are run only with the project owner's approval. Results: [`TEST_REPORT.md`](TEST_REPORT.md).

## Documentation

| Document | Content |
|---|---|
| [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md) | Architecture, data flow, security design, AI concepts |
| [`FEATURE_STATUS.md`](FEATURE_STATUS.md) | What is implemented vs planned |
| [`TEST_REPORT.md`](TEST_REPORT.md) | Tests actually executed and their results |
| [`AI_ETHICS.md`](AI_ETHICS.md) | Risks, safeguards, limitations |
| [`AI_USAGE_DISCLOSURE.md`](AI_USAGE_DISCLOSURE.md) | Who/what built which part, and how AI is used |
| [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md) | Decisions, errors and fixes |
| [`WAICY_SUBMISSION_CHECKLIST.md`](WAICY_SUBMISSION_CHECKLIST.md) | Competition deliverables and checks |
| [`docs/LIVE_AI_SETUP.md`](docs/LIVE_AI_SETUP.md) | Live AI setup, readiness check, first controlled live test, error messages |
| [`docs/planned/GOOGLE_SIGN_IN.md`](docs/planned/GOOGLE_SIGN_IN.md) | Planned (not implemented) optional sign-in design |
| [`docs/waicy/PROJECT_DOSSIER.md`](docs/waicy/PROJECT_DOSSIER.md) | WAICY dossier: problem, solution, AI, architecture, innovation, ethics, limitations, testing, journey |
| [`docs/waicy/DEMO_SCRIPT.md`](docs/waicy/DEMO_SCRIPT.md) | Demo video script (≤ 3 min) |
| [`docs/waicy/JUDGE_QA.md`](docs/waicy/JUDGE_QA.md) | Judge Q&A preparation |
| [`submission/`](submission/) | Final WAICY package: project description (with the < 200-word text), AI technical explanation, 2:45 demo script, submission checklist |

## Licence

All rights reserved (private competition project).
