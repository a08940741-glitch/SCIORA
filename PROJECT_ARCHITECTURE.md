# SCIORA — Project Architecture (Phase 1)

_Status: describes the code as implemented on 2026-11-20. Planned features are marked as such._

## 1. Overview

```
┌──────────── Browser (vanilla JS, Arabic RTL) ────────────────┐
│ index.html · app.js · render.js (textContent only)           │
│ learner-model.js: preliminary level estimate (localStorage)  │
│ Holds only public exercise text + an opaque encrypted token  │
└──────────────┬───────────────────────────────────────────────┘
               │ same-origin JSON
┌──────────────▼──────── Node 22 · Fastify · TypeScript ───────┐
│ GET /api/health   POST /api/learn   POST /api/grade           │
│ zod validation · helmet CSP · rate limit · 32 KB body limit   │
│                                                               │
│ domain/  schemas · exercise-token (AES-256-GCM) · replay-store│
│          normalize · grading (rules) · rubric-aggregate       │
│          lesson-integrity · feedback                          │
│ ai/      AIProvider ──► AnthropicProvider | DemoProvider      │
│ config   demo unless SCIORA_AI_MODE=live + API key            │
└──────────────┬───────────────────────────────────────────────┘
               │ server only (key never leaves the server)
        Anthropic Messages API — live mode only
```

| Folder | Responsibility |
|---|---|
| `src/config.ts` | Reads and validates environment variables; chooses demo/live; secret rules. |
| `src/app.ts` | Builds the HTTP server, security plugins and the three routes. |
| `src/domain/` | Pure logic: schemas, encryption, replay protection, grading, aggregation. No AI vendor code. |
| `src/ai/` | Provider abstraction, prompts, Anthropic provider, demo provider and its content. |
| `public/` | Browser application (no build step). |
| `test/` | Unit, API and browser (Playwright) tests; grading fixtures. |
| `scripts/` | Secret scan; gated live smoke test and grading evaluation. |

## 2. Data flow

### 2.1 `POST /api/learn`
1. Validate `{question (3–1000 chars), level, language}`; unknown fields rejected.
2. **Capacity check:** if the replay store is ≥ 90% full → `503 capacity_exceeded` (before any AI cost).
3. Daily AI limit (live mode only).
4. `provider.generateLesson()` →
   - **Live:** one structured-output call to `SCIORA_MODEL_LEARN` (Sonnet 5.5, effort medium). The response must match the `GeneratedLesson` zod schema; it is validated again locally. Refusal → polite error; cut-off or invalid output → one retry, then error.
   - **Demo:** keyword match against 5 pre-written lessons; unknown topic → `404 not_in_demo`.
   - A live failure is **never** replaced by demo content.
5. `enforceLessonIntegrity()` drops exercises that fail checks a schema cannot express (MCQ answer must be a listed choice, expression must parse, unique ids).
6. Answer keys and rubrics are **sealed** into an encrypted exercise token.
7. Response: public lesson (whitelisted fields only) + `exerciseSet.token` + `meta` provenance.

### 2.2 `POST /api/grade`
1. Validate `{token, exerciseId, answer}`.
2. Open the token (AES-256-GCM). Forged/tampered → `400 invalid_token`; expired → `410`.
3. **Pre-checks that do not consume the attempt and reveal nothing about correctness:** invalid MCQ choice → 400; unreadable number/expression → `422` with a format hint.
4. **Atomic reservation** of `(tokenId, exerciseId)` in the replay store (see §3.3).
5. Grade:
   - MCQ / numeric / expression → **rules** (`domain/grading.ts`).
   - Written answer → **rubric judgement** by `SCIORA_MODEL_FAST` (Haiku 5.5, effort low) → **server-side aggregation** (`domain/rubric-aggregate.ts`). Optional escalation of "uncertain" to the LEARN model.
6. Store the result; later requests for the same exercise receive **the original result** (`409 already_graded`, `replayed: true`).

## 3. Security architecture

### 3.1 API key
Server-side only (`ANTHROPIC_API_KEY`), retained in memory only in live mode. Never sent to the browser, never logged (pino redaction + tests), `.env*` git-ignored, `scripts/secret-scan.sh` run before every commit.

### 3.2 Encrypted exercise tokens (`domain/exercise-token.ts`)
- Format `v1.<kid>.<iv>.<ciphertext>.<tag>`.
- **AES-256-GCM** with a key derived from `SCIORA_TOKEN_SECRET` by **HKDF-SHA256**; random 96-bit IV per token; random 128-bit token id.
- **AAD** `sciora:exercise:v1|<kid>` binds the token to its purpose and key.
- GCM authentication tag ⇒ any modification or forgery fails.
- `exp`/`iat` inside the ciphertext; 2 h lifetime; 60 s clock tolerance.
- `kid` allows key rotation. Production refuses to start without the secret; development uses a temporary random key.

### 3.3 Replay store (`domain/replay-store.ts`)
- One graded attempt per `(tokenId, exerciseId)`. States: `PENDING → DONE{result}` or `PENDING → FAILED_RETRYABLE{answerHash}`.
- **Atomic:** `reserve()` is synchronous; Node runs JavaScript on one thread, so simultaneous requests cannot both pass. Grading starts only after reservation.
- Repeat submission → original result. Failed grading → only the **same** answer may retry (prevents trying other answers by provoking failures). Stuck `PENDING` (> 150 s) → `FAILED_RETRYABLE`.
- **Fail-closed capacity:** unexpired records are **never** evicted; only expired ones are removed. Full → `503` (“your answer was NOT graded”) with `Retry-After`.
- Answers are stored only as keyed HMAC-SHA256 hashes of the normalized text.
- **Limitations:** in memory (a restart clears it; tokens issued before a restart could be re-graded until they expire); atomic within **one** Node process only.

### 3.4 Other controls
zod validation with length limits; 32 KB body limit; helmet CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`); all AI text rendered with `textContent`; no CORS; per-IP rate limit; daily AI-call limit; generic error messages; fixed system prompts with student text inside delimited tags treated as data.

## 4. AI design

### 4.1 Provider abstraction
`AIProvider` (`generateLesson`, `judgeWritten`) is implemented by `AnthropicProvider` and `DemoProvider`. The rest of the code never calls a vendor SDK directly.

### 4.2 Model routing (configurable)
| Tier | Default | Phase 1 use |
|---|---|---|
| LEARN | `claude-sonnet-5-5` | Lessons; escalated grading |
| FAST | `claude-haiku-5-5` | Rubric judgement of written answers |
| REASON | `claude-opus-5-5` | Reserved for Phase 2 (unused) |

Server-side refusal fallback (`fallbacks: "default"`) is requested on models that support it (not Haiku). **Not yet verified against the live API.**

### 4.3 Written-answer grading (three layers)
1. **Rules first:** normalization (Arabic diacritics, alef forms, Eastern Arabic digits, decimal separators), numeric equivalence, sandboxed algebraic equivalence (mathjs with a strict node whitelist, evaluated at random points).
2. **Rubric judgement by the AI:** per criterion `met | partial | not_met | unclear` with an exact quote as evidence. The prompt instructs it to judge meaning, accept Darija/MSA/French/Arabizi, ignore spelling unless language-sensitive, and use `unclear` when unsure.
3. **Server decides:** quotes not found in the answer → `unclear`; any required criterion unclear or low confidence → **uncertain**; all required met → correct; all clearly not met → incorrect; otherwise partially correct.

### 4.4 Preliminary level estimate (`public/js/learner-model.js`)
Elo-style rating per topic: start 1000, exercise difficulty by level (900–1200), K = 48/32/16 by number of answers. Only real graded results count; **uncertain is ignored**. Shown as “estimated level · based on N answers · confidence”; below 5 answers confidence is always “low”. It never claims mastery.

**localStorage limitations:** one browser on one device; lost when browser data is cleared or in private mode; editable by the user (not trustworthy for certification); visible to the next user on a shared computer (a “Clear my data” button is provided). The server never relies on it.

### 4.5 AI concepts (AI4K12 “Five Big Ideas”) — honest mapping
| Big idea | In SCIORA Phase 1 |
|---|---|
| Perception | **Not implemented.** (Photo input of homework is a stretch goal.) |
| Representation & Reasoning | Structured lesson/rubric schemas; rule-based maths reasoning (equivalence checking); server-side rubric aggregation. |
| Learning | SCIORA does **not** train a model. The language models are pre-trained by Anthropic. SCIORA's own adaptive component is the Elo-style learner estimate that updates from the student's graded answers. |
| Natural Interaction | Questions and answers in Moroccan Darija, Arabic, French; explanations generated in natural language (live mode). |
| Societal Impact | Transparency labels, uncertainty handling, privacy-by-design, ethics documentation (`AI_ETHICS.md`). |

## 5. Planned (not implemented)
Knowledge Explorer, Evidence Analyzer, Progress screen, landing page and settings, French interface, optional Google Sign-In ([design](docs/planned/GOOGLE_SIGN_IN.md)), persistent (SQLite) replay store. Phase 1 has **no database and no accounts**.
