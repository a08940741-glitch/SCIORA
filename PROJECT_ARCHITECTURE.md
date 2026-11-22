# SCIORA — Project Architecture (Phase 1 + 2A + 2B)

_Status: describes the code as implemented on 2026-11-20 (Phase 1 and Phase 2A). Planned features are marked as such._

## 1. Overview

```
┌──────────── Browser (vanilla JS, English, LTR) ──────────────┐
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
│ ai/      AIProvider ──► Anthropic | Groq | DemoProvider       │
│ config   demo unless SCIORA_AI_MODE=live + provider's API key │
└──────────────┬───────────────────────────────────────────────┘
               │ server only (key never leaves the server)
   Anthropic Messages API  or  Groq Chat Completions (OpenAI-
   compatible, built-in fetch) — live mode only, one at a time
```

| Folder | Responsibility |
|---|---|
| `src/config.ts` | Reads and validates environment variables; chooses demo/live; secret rules. |
| `src/app.ts` | Builds the HTTP server, security plugins and the three routes. |
| `src/domain/` | Pure logic: schemas, encryption, replay protection, grading, aggregation. No AI vendor code. |
| `src/ai/` | Provider abstraction, prompts, Anthropic provider, Groq provider (client, strict-schema adapter), demo provider and its content. |
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

### 4.0 Language policy (English-only)
SCIORA is an English-only AI learning and knowledge platform designed for an international audience. Enforcement points (`src/domain/english-only.ts`):
- **Input:** `/api/learn`, `/api/knowledge/query`, `/api/knowledge/transform`, `/api/evidence/analyze` and written answers in `/api/grade` reply `422 english_only` with “SCIORA currently supports English only. Please submit your question in English to continue.” when the text is *clearly* not English (heuristic: mostly non-Latin script, or several French/Spanish/Arabizi function words and no English ones). Numbers, expressions and multiple-choice answers are never language-checked. The check runs before the daily cap and before an answer is reserved, so it costs nothing and never consumes an attempt.
- **Prompts:** every system prompt includes the same mandatory `ENGLISH_ONLY_RULE` (`src/ai/prompts.ts`).
- **Output:** both live structured-call paths (Anthropic and Groq) run `findNonEnglishOutput` after schema validation; clearly non-English or mixed-language output is retried once, then rejected (`bad_output`, "The AI response was not in English."). Source quotes are exempt.
- **Content and retrieval:** demo content is English-only; Wikipedia retrieval uses English Wikipedia only (no fallback to other wikis).
- **Limit:** these are heuristics; they catch clearly non-English text but do not guarantee perfect English.

### 4.1 Provider abstraction
`AIProvider` (`generateLesson`, `judgeWritten`) is implemented by `AnthropicProvider`, `GroqProvider` and `DemoProvider`. The rest of the code never calls a vendor SDK directly. `SCIORA_AI_PROVIDER` selects the live provider (`anthropic` by default, or `groq`); demo stays the default mode, and a live failure is never replaced by demo content.

**Groq provider** (`src/ai/groq-client.ts`, `groq-schema.ts`, `groq-provider.ts`, plus `src/knowledge/groq-provider.ts` and `src/evidence/groq-provider.ts`):
- Uses Groq's OpenAI-compatible Chat Completions API through Node's built-in `fetch` (no extra package), with strict structured outputs (`response_format.json_schema`, `strict: true`).
- The same zod schemas are converted with zod 4's `z.toJSONSchema`, then adapted to the keywords Groq documents for strict mode: discriminated unions become `anyOf`, literals become one-value `enum`s, exact single-character patterns (e.g. quiz choice ids `^[a-d]$`) become `enum`s, and other length/pattern/range constraints move into descriptions. **Every response is still validated locally with the full zod schema**, so no validation is weakened.
- Conversion happens **at request time** (on the first request that uses a schema, then cached), not at startup. A schema Groq cannot represent (optional fields, records) makes that request fail with a generic server error; nothing is sent to Groq. All seven current schemas convert (covered by tests).
- Conservative retries (free-tier friendly): 429, 5xx, timeouts, network errors and **cut-off output** (`finish_reason: "length"`, since the identical request would be cut off again) are not retried; only malformed JSON or a schema mismatch is retried once. At most 2 requests per call.
- Response bodies are capped at 1 MiB (checked against `Content-Length` and while streaming; oversized bodies are cancelled). One timeout covers waiting for headers and reading the body.
- The key is read only from `GROQ_API_KEY`, kept in a private field, and sent only in the `Authorization` header. Provider error bodies are never read into messages or logs.
- Same prompts, integrity checks, server-side source/evidence checks, verdicts, rate limit and daily cap as the Anthropic path. On 2026-11-21 a **first controlled live test with Groq** (`openai/gpt-oss-120b`, free tier) completed all 6 AI calls (lesson, grading of a correct and a wrong answer, knowledge answer with Wikipedia sources, simplify, evidence analysis) and passed SCIORA's automatic checks; the first run hit Groq's free-tier rate limit at call 5, and the last two calls passed after a pause. Tested in English only; content not yet reviewed by a teacher. **Anthropic has still never been run against the real API.**

**Prompt-injection hygiene (all providers):** every piece of untrusted text (lesson questions, written answers, Knowledge questions and sources, claims, transform content) passes through `src/domain/prompt-safety.ts` before it is placed between the prompt's delimiter tags: `<`/`>` become look-alike guillemets so the text cannot close a tag, invisible control/bidi characters are removed, and length is capped (question 1,000, answer 2,000 characters). The written-answer quote check applies the same transformation to both sides, so genuine quotes still match.

### 4.2 Model routing (configurable)
| Tier | Default | Phase 1 use |
|---|---|---|
| LEARN | `claude-sonnet-5-5` | Lessons; escalated grading |
| FAST | `claude-haiku-5-5` | Rubric judgement of written answers |
| REASON | `claude-opus-5-5` | Reserved for Phase 2 (unused) |

Server-side refusal fallback (`fallbacks: "default"`) is requested on models that support it (not Haiku). **Not yet verified against the live API.**

### 4.3 Written-answer grading (three layers)
1. **Rules first:** normalization (number formats incl. Eastern Arabic digits and decimal separators, kept for robust number parsing), numeric equivalence, sandboxed algebraic equivalence (mathjs with a strict node whitelist, evaluated at random points).
2. **Rubric judgement by the AI:** per criterion `met | partial | not_met | unclear` with an exact quote as evidence. The prompt instructs it to judge meaning (English answers), ignore spelling, and use `unclear` when unsure. Written answers that are clearly not English are refused before grading (English-only policy).
3. **Server decides:** quotes not found in the answer → `unclear`; any required criterion unclear or low confidence → **uncertain**; all required met → correct; all clearly not met → incorrect; otherwise partially correct.

### 4.4 Preliminary level estimate (`public/js/learner-model.js`)
Elo-style rating per topic: start 1000, exercise difficulty by level (900–1200), K = 48/32/16 by number of answers. Only real graded results count; **uncertain is ignored**. Shown as “estimated level · based on N answers · confidence”; below 5 answers confidence is always “low”. It never claims mastery.

**localStorage limitations:** one browser on one device; lost when browser data is cleared or in private mode; editable by the user (not trustworthy for certification); visible to the next user on a shared computer (a “Clear my data” button is provided). The server never relies on it.

### 4.5 AI concepts (AI4K12 “Five Big Ideas”) — honest mapping
| Big idea | In SCIORA Phase 1 |
|---|---|
| Perception | **Not implemented.** (Photo input of homework is a stretch goal.) |
| Representation & Reasoning | Structured lesson/rubric schemas; rule-based maths reasoning; server-side rubric aggregation; Knowledge Explorer answers represented as typed segments (fact / explanation / assumption / uncertainty) with server-checked source links and concept connections. |
| Learning | SCIORA does **not** train a model. The language models are pre-trained by Anthropic. SCIORA's own adaptive component is the Elo-style learner estimate that updates from the student's graded answers. |
| Natural Interaction | Questions, answers and claims in English; explanations generated in natural, student-friendly English (live mode). |
| Societal Impact | Transparency labels, uncertainty handling, privacy-by-design, ethics documentation (`AI_ETHICS.md`). |

## 5. Knowledge Explorer (Phase 2A)

### 5.1 Modules
| File | Responsibility |
|---|---|
| `src/knowledge/schemas.ts` | Requests, AI output (no title/URL fields), sources, response shapes. Independent of Phase 1 schemas. |
| `src/knowledge/retriever.ts` | `SourceRetriever` interface; `NoopRetriever` (the only production retriever — decision D1). |
| `src/knowledge/service.ts` | Retrieval (abort + 8 s timeout) → provider → `finalizeAnswer`; `transform()`. |
| `src/knowledge/sources.ts` | Source sanitizing; citation validation; server-side verification status. |
| `src/knowledge/learning.ts` | Connection cleaning; quiz integrity checks. |
| `src/knowledge/provider.ts`, `demo-provider.ts`, `anthropic-provider.ts`, `prompts.ts`, `index.ts` | Provider abstraction (separate from Phase 1's), demo content (no sources), live provider via the shared `src/ai/structured-call.ts`, fixed prompts, factory with the same live rule as Phase 1. |
| `src/knowledge/routes.ts` | `POST /api/knowledge/query`, `POST /api/knowledge/transform`. |
| `src/http.ts` | Shared `DailyBudget` and `sendError` (moved from `app.ts`). |
| `public/js/explorer.js`, `cards.js`, `cards-store.js`, `errors.js` | Explorer UI, cards panel, browser-only card store, shared error messages. |

### 5.2 Query flow
1. Validate `{question, level, language}`.
2. Shared daily limit (live only).
3. **Retrieval** only if the provider is live **and** a retriever is enabled. Phase 2A: never (NoopRetriever) → `retrievalNote: "disabled"`.
4. Provider answer. Sources (if any) are passed only as neutralized `<source id="S1">` blocks; the system prompt says sources and question are data.
5. **`finalizeAnswer` (server):** drops source ids that were not retrieved (counted, disclosed), computes `uncitedFacts`, decides status:
   - demo provider → `demo`;
   - ≥ 1 segment cites a retrieved source → `source_backed` (“backed by retrieved sources”, not “true”);
   - otherwise → `not_source_verified`.
6. Connections cleaned and marked `suggested: true`.

### 5.3 Source rules
- The AI output schema has no fields for titles, URLs or publishers; source metadata only comes from a retriever.
- Retrieved items: schema-validated, **https only**, no URL credentials, control/bidi characters removed, title ≤ 300 / excerpt ≤ 1500 chars, duplicates dropped, max 5, ids re-assigned `S1..S5` by the server.
- Demo content contains no sources and no URLs (enforced by a test and stripped in code).

### 5.4 Learning mode
`simplify` / `examples` / `quiz` via the FAST model (live) or pre-written content (demo). Quiz questions with a missing correct choice or duplicate ids are dropped; none left → `bad_output`. **Independent of Phase 1 grading**: no token, no replay store, no level estimate; the quiz is checked locally in the browser and labelled self-check.

### 5.5 Knowledge cards (browser only)
`sciora.cards.v1` in localStorage, max 200. Status copied from the server at save time (`demo` / `not_source_verified` / `sources_attached`); `checkedByMe` is a separate flag and cannot upgrade the status. Every card is re-validated on load (invalid cards dropped, non-https links removed, impossible statuses downgraded). Limitations: per browser, user-editable, visible on shared computers.

### 5.6 Model routing
Answers: LEARN (Sonnet 5.5, effort medium). Transforms: FAST (Haiku 5.5, effort low). REASON unused. All configurable; no live calls made so far.

## 6. Evidence Analyzer (Phase 2B)

### 6.1 Modules
| File | Responsibility |
|---|---|
| `src/evidence/schemas.ts` | Request, AI output (no URL/title/verdict fields), response shapes. |
| `src/evidence/verdicts.ts` | Evidence check (quote must appear in the cited retrieved source's excerpt, ≥ 8 normalized chars, no duplicates) and verdict rules. |
| `src/evidence/prompts.ts` | Fixed system prompt; claim and sources neutralized inside delimited data blocks. |
| `src/evidence/provider.ts` | `EvidenceProvider`; `AnthropicEvidenceProvider` (REASON tier, shared structured call); `DemoEvidenceProvider` (no evidence ever). |
| `src/evidence/service.ts` | Shared `runRetrieval()` → provider → evidence check → verdicts; factory with the standard demo/live rule. |
| `public/js/evidence.js` | Evidence tab UI. |

### 6.2 Verdict rules (server)
- Sub-claim: non-factual types → **not checkable**; no verified supports/contradicts → **insufficient evidence**; only supports → **supported**; only contradicts → **contradicted**; both → **mixed**. "Context" evidence is shown but never decides.
- Overall (over checkable sub-claims): none → not checkable; any mixed or supported+contradicted → mixed; all supported → supported; all contradicted → contradicted; otherwise insufficient evidence.
- `basis.kind` is `retrieved_sources` only if at least one verified evidence item exists; removed items are counted and disclosed.
- Sub-claim ids are assigned by the server.

### 6.3 Shared components
`runRetrieval()` (moved from `KnowledgeService`, behaviour-preserving), `sanitizeSources`, `callStructured`, `DailyBudget`, rate limit, CSP. With the `NoopRetriever`, factual claims always receive *insufficient evidence*.

## 7. Learning Progress
`public/js/progress.js` + `summarizeProgress()` in `learner-model.js`. Reads only the browser-stored learner estimate and card count. Recommendation rules: ≥ 2 answers and (incorrect + ½·partial > correct, or level beginner) → review; fewer than 5 answers → practice more; otherwise next level (or keep at advanced). Uncertain results were never stored, so they never count.

## 8. Interface languages
- `public/js/i18n.js`: `en` (default) and `ar` dictionaries with identical keys (unit-tested). The interface language is stored in `localStorage` (`sciora.ui.lang`), applied on load (`<html lang dir>`), and switched from the header (page reload).
- Interface language ≠ learning / AI response language (selected per tool).
- The page is English and left-to-right (`<html lang="en" dir="ltr">`); there is no language switcher and no right-to-left layout.
- Server system notices are codes (`src/notices.ts`) translated by `public/js/notices.js`.

## 9. Wikipedia retrieval
`src/knowledge/wikipedia-retriever.ts` implements `SourceRetriever` with the MediaWiki Action API (`generator=search`, intro plain-text extracts, `inprop=url`, latest revision timestamp, `ppprop=disambiguation`, `maxlag=5`). Fixed hosts `{ar,fr,en}.wikipedia.org` chosen by query script and answer language (max 2, with fallback on errors). Throttle (min interval), 1 h cache, ≤ 2 retries per wiki with exponential backoff honouring `Retry-After` (capped), abort-aware waits, response size cap, schema validation, https + exact-host URL check. `publishedAt` is always null (no publication date exists); `lastModified` comes from the API. Results then pass `sanitizeSources()`. Demo mode shows results as related reading only; `wikipedia_only` notice when an answer/verdict rests only on Wikipedia.

## 10. Planned (not implemented)
Retrieval sources beyond Wikipedia, landing page and settings, optional Google Sign-In ([design](docs/planned/GOOGLE_SIGN_IN.md)), persistent (SQLite) replay store. There is **no database and no accounts**.
