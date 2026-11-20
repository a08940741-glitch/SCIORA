# SCIORA — Test Report

_Only executed tests are listed; every row was produced by running the test file. History: Phase 1 154/154 (`163b128`), Phase 2A 235/235 (`d8ee223`)._

## Run summary (Phase 2B + Learning Progress)

| Item | Value |
|---|---|
| Date | 2026-11-20 |
| Code version | commit `4b0f1da` + documentation changes (no code changes after this run) |
| Environment | Linux container, Node 22.23.5, Chromium (pre-installed Playwright) |
| AI mode during tests | **Demo mode or FAKE AI client / FAKE retriever. No real API call and no external network call.** |
| Automated tests | **284 / 284 passed**, 0 failed, 0 skipped |
| Unit + API | 262 / 262 passed |
| Browser (Playwright) | 22 / 22 passed |
| Typecheck | passed |
| `npm audit` | 0 vulnerabilities |
| New dependencies since Phase 1 | none |
| Secret scan | passed |
| Manual server smoke (`npm start`, demo) | health: all three modules demo, retrieval off; evidence analysis of a compound claim → 2 sub-claims, insufficient_evidence, basis none |

## Changes to existing tests in Phase 2B (disclosed)

| Test | Change | Reason |
|---|---|---|
| `api.test.ts`, `knowledge-api.test.ts` — health | Assert `evidence_analyzer` is no longer planned; `real_source_retrieval` still is | Evidence Analyzer implemented; real retrieval still missing. |
| `workspace.e2e.test.ts` — planned feature check | Now asserts no Google Sign-In control exists | Explorer and Evidence are implemented; Google Sign-In is the remaining planned UI feature. |
| `explorer.e2e.test.ts` — keyboard tabs | Tab order now includes the Evidence tab and checks wrap-around | A 4th tab was added. |
| `test/helpers/app.ts` | Optional `evidenceProvider` | To inject fakes. |
| `explorer.e2e.test.ts` — keyboard tabs (Progress milestone) | Tab order read from the DOM; asserts the 5 tabs, focus follows selection, wrap-around both ways | Stronger and robust to future tabs. |

## NOT executed / not verified

| Item | Status |
|---|---|
| Any live AI call (lessons, grading, knowledge, evidence) | **Not run** — no key, no approval |
| `npm run eval:grading`, `npm run test:live` | **Not run** (gated) |
| Real source retrieval | **Not implemented** — factual claims always get *insufficient evidence* outside tests |
| Quality of live evidence analysis (claim splitting, classification) | **Not evaluated** |
| Owner review of all demo content and grading labels | **Pending** |

## What the Phase 2B tests prove — and what they do not

- **Prove:** evidence counts only when it quotes the excerpt of a server-retrieved source (fabricated quotes, unknown ids and duplicates are removed and disclosed); the AI cannot set verdicts or sub-claim ids; opinions, predictions, value judgments and ambiguous claims are never rated true/false; overall verdict rules (incl. mixed and insufficient); retrieval timeout degrades safely; provider errors map to HTTP errors and are never replaced by demo content; no prompts, secrets or claim text leak to responses or logs; shared daily limit and rate limit; the UI labels AI background as not evidence, shows no English words in Arabic interface text, and works on mobile.
- **Do not prove:** that a live model splits and classifies claims well, or that real sources would be retrieved — no retriever exists.

## Detailed results

### `test/unit/cards-store.test.ts` — 11/11 passed

| # | Test | Result |
|---|---|---|
| 1 | card from a demo answer: status demo, no sources, origin demo | ✅ PASS |
| 2 | card from a live un-sourced answer: not_source_verified | ✅ PASS |
| 3 | card from a source-backed answer keeps ONLY cited sources | ✅ PASS |
| 4 | add / list / search / collections / update / remove | ✅ PASS |
| 5 | checkedByMe never upgrades the source status | ✅ PASS |
| 6 | tampered storage: invalid cards dropped, javascript: links removed, impossible statuses downgraded | ✅ PASS |
| 7 | corrupted JSON and wrong version reset safely | ✅ PASS |
| 8 | limit of 200 cards is enforced | ✅ PASS |
| 9 | field lengths are capped and control/bidi characters removed | ✅ PASS |
| 10 | invalid input (no title) is refused; storage failure reported | ✅ PASS |
| 11 | export contains the cards and no secrets | ✅ PASS |

### `test/unit/config.test.ts` — 13/13 passed

| # | Test | Result |
|---|---|---|
| 1 | defaults: demo mode, approved model routing, ephemeral secret in development | ✅ PASS |
| 2 | key-alone-does-not-enable-live: an API key without SCIORA_AI_MODE=live stays in demo | ✅ PASS |
| 3 | live mode requires a key | ✅ PASS |
| 4 | live mode with key is accepted (configuration only; no network call is made) | ✅ PASS |
| 5 | prod-requires-secret: production refuses to start without SCIORA_TOKEN_SECRET | ✅ PASS |
| 6 | secret shorter than 32 bytes is rejected | ✅ PASS |
| 7 | production with a valid secret works and is not ephemeral | ✅ PASS |
| 8 | hex secrets are accepted | ✅ PASS |
| 9 | model routing is configurable through environment variables | ✅ PASS |
| 10 | invalid model id is rejected | ✅ PASS |
| 11 | invalid values report variable names only, never values | ✅ PASS |
| 12 | escalation and live-test switches parse on/off values | ✅ PASS |
| 13 | unknown AI mode is rejected | ✅ PASS |

### `test/unit/errors-ui.test.ts` — 4/4 passed

| # | Test | Result |
|---|---|---|
| 1 | network failure → localized network message | ✅ PASS |
| 2 | known codes → Darija message; unknown → server message → generic | ✅ PASS |
| 3 | unreadable_answer keeps the server's localized hint | ✅ PASS |
| 4 | Retry-After is shown in seconds/minutes for rate limit and capacity only | ✅ PASS |

### `test/unit/evidence-service.test.ts` — 12/12 passed

| # | Test | Result |
|---|---|---|
| 1 | demo content: 5 files, unreviewed, no evidence and no URLs anywhere (D1) | ✅ PASS |
| 2 | demo matches Darija, French, English and Arabizi claims | ✅ PASS |
| 3 | demo verdicts: factual → insufficient_evidence (no sources), opinion/prediction → not_checkable | ✅ PASS |
| 4 | demo: unknown claim → not_in_demo; other language → honest caveat | ✅ PASS |
| 5 | live, no retrieval (D1): AI-invented evidence removed → insufficient_evidence, removal disclosed | ✅ PASS |
| 6 | live + FAKE retriever: real quote → contradicted; fabricated quote removed | ✅ PASS |
| 7 | live + FAKE retriever: opinion stays not_checkable even with a real quote | ✅ PASS |
| 8 | retriever failure/timeout degrades to no evidence (insufficient), not an error | ✅ PASS |
| 9 | provider errors (refusal, malformed, 429, connection) propagate as ProviderError | ✅ PASS |
| 10 | hostile claim and hostile source cannot break prompt delimiters | ✅ PASS |
| 11 | factory: demo never creates a client; live uses the REASON model | ✅ PASS |
| 12 | sub-claim ids are re-assigned by the server (duplicates from the AI cannot collide) | ✅ PASS |

### `test/unit/evidence-verdicts.test.ts` — 8/8 passed

| # | Test | Result |
|---|---|---|
| 1 | request: limits, default language, strict | ✅ PASS |
| 2 | AI output cannot carry URLs, titles or a verdict field | ✅ PASS |
| 3 | quote must appear in the cited source's excerpt (normalized) | ✅ PASS |
| 4 | evidence with unknown source id, fabricated quote, or duplicate is removed and counted | ✅ PASS |
| 5 | no retrieved sources → every evidence item is removed | ✅ PASS |
| 6 | sub-claim verdicts from verified evidence only | ✅ PASS |
| 7 | opinions, predictions, value judgments and ambiguous claims are not checkable (even with 'evidence') | ✅ PASS |
| 8 | overall verdict rules | ✅ PASS |

### `test/unit/exercise-token.test.ts` — 15/15 passed

| # | Test | Result |
|---|---|---|
| 1 | token-roundtrip: seal then open returns the same payload | ✅ PASS |
| 2 | token-is-opaque: no answer or rubric text in any decoded part of the token | ✅ PASS |
| 3 | token-is-opaque: two tokens for the same content differ (fresh IV and tid) | ✅ PASS |
| 4 | forged-token-rejected: token built with a different key | ✅ PASS |
| 5 | forged-token-rejected: hand-made token with plaintext JSON and random tag | ✅ PASS |
| 6 | tampered-ciphertext-rejected: one character changed in IV, ciphertext, or tag | ✅ PASS |
| 7 | wrong-aad-or-kid-rejected: unknown kid | ✅ PASS |
| 8 | wrong-aad-or-kid-rejected: ciphertext sealed with correct key but different AAD purpose | ✅ PASS |
| 9 | malformed-token-rejected: wrong shapes never crash | ✅ PASS |
| 10 | malformed-token-rejected: wrong IV or tag length | ✅ PASS |
| 11 | expired-token-rejected: exp + 61 s is rejected with code expired (HTTP 410) | ✅ PASS |
| 12 | future-iat-rejected: token issued beyond clock skew is rejected | ✅ PASS |
| 13 | key rotation: old key still opens, new tokens use the first key | ✅ PASS |
| 14 | short secrets are refused | ✅ PASS |
| 15 | error httpStatus is 400 for non-expiry failures (no detail leaked) | ✅ PASS |

### `test/unit/grading-deterministic.test.ts` — 15/15 passed

| # | Test | Result |
|---|---|---|
| 1 | normalize: removes tashkeel and tatweel | ✅ PASS |
| 2 | normalize: unifies alef forms and alef maksura | ✅ PASS |
| 3 | normalize: Eastern Arabic and Persian digits become 0-9 | ✅ PASS |
| 4 | normalize: Arabic decimal separator, case, spaces, math symbols | ✅ PASS |
| 5 | normalizeForMatch: drops punctuation for quote checks | ✅ PASS |
| 6 | mcq: by id (case-insensitive) and by exact choice text | ✅ PASS |
| 7 | numeric: 1/2 = 0.5 = ٠٫٥ = x=0.5 = 0,5 = .5 = ½ = 50% (when allowed) | ✅ PASS |
| 8 | numeric: within tolerance passes, outside fails definitively | ✅ PASS |
| 9 | numeric: percent refused when not allowed (→ unparsed, not incorrect) | ✅ PASS |
| 10 | numeric: unparseable goes to AI layer, never straight to incorrect | ✅ PASS |
| 11 | numeric: matching unit suffix is accepted | ✅ PASS |
| 12 | expression: equivalent forms are equivalent | ✅ PASS |
| 13 | expression: non-equivalent forms are detected | ✅ PASS |
| 14 | expression: unparseable or disallowed input → unknown (goes to AI, not incorrect) | ✅ PASS |
| 15 | expression: gradeExpression maps outcomes | ✅ PASS |

### `test/unit/grading-fixtures.test.ts` — 6/6 passed

| # | Test | Result |
|---|---|---|
| 1 | fixture set: ≥30 cases, ≥3 subjects, all required categories present | ✅ PASS |
| 2 | fixture sanity: every met/partial evidence quote really appears in its answer | ✅ PASS |
| 3 | pipeline: every fixture case produces its expected verdict | ✅ PASS |
| 4 | pipeline safety: no CORRECT-category answer is ever graded incorrect | ✅ PASS |
| 5 | demo keyword grader safety on fixtures: never 'incorrect', never a false 'correct' | ✅ PASS |
| 6 | review status is reported honestly (owner review still pending) | ✅ PASS |

### `test/unit/knowledge-learning.test.ts` — 6/6 passed

| # | Test | Result |
|---|---|---|
| 1 | connections: duplicates, the topic itself and overflow are removed | ✅ PASS |
| 2 | quiz cleaning: questions with a missing correct choice or duplicate ids are dropped | ✅ PASS |
| 3 | quiz with no valid question → bad_output from the service | ✅ PASS |
| 4 | learning mode via service (demo): simplify, examples, quiz; quiz flagged self-check only | ✅ PASS |
| 5 | learning mode is independent of Phase 1 grading (no token, no exercise set in the response) | ✅ PASS |
| 6 | demo query returns cleaned suggestions for every topic | ✅ PASS |

### `test/unit/knowledge-providers.test.ts` — 10/10 passed

| # | Test | Result |
|---|---|---|
| 1 | demo knowledge content: 5 valid files, unreviewed, ZERO sources/citations anywhere (D1) | ✅ PASS |
| 2 | demo matches Darija, MSA, French, English and Arabizi questions | ✅ PASS |
| 3 | demo answer: labelled demo, DEMO caveat first, no sources even if a citation sneaks into content | ✅ PASS |
| 4 | demo answer: other language / level → honest caveats in Darija | ✅ PASS |
| 5 | demo: unknown topic → not_in_demo (404), never invented content | ✅ PASS |
| 6 | demo transforms: simplify / examples / quiz for a known topic | ✅ PASS |
| 7 | live answer: LEARN model, medium effort, fallback, fixed system prompt, question + empty-sources notice | ✅ PASS |
| 8 | live transform: FAST model (Haiku), low effort, mode-specific schema | ✅ PASS |
| 9 | live provider error handling is the shared Phase 1 behaviour (refusal, malformed, 429, unavailable) | ✅ PASS |
| 10 | factory: demo config never creates a client; live config uses the factory (fake) | ✅ PASS |

### `test/unit/knowledge-schemas.test.ts` — 8/8 passed

| # | Test | Result |
|---|---|---|
| 1 | knowledge query: defaults, trimming, limits, strictness | ✅ PASS |
| 2 | knowledge query accepts all supported answer languages incl. English | ✅ PASS |
| 3 | AI answer schema: valid sample passes | ✅ PASS |
| 4 | AI answer schema has NO way to carry source titles or URLs | ✅ PASS |
| 5 | segment kinds are restricted to fact / explanation / assumption / uncertainty | ✅ PASS |
| 6 | transform request: modes, strict content, limits | ✅ PASS |
| 7 | quiz output: choice ids a-d only | ✅ PASS |
| 8 | retrieved source schema requires a real URL | ✅ PASS |

### `test/unit/knowledge-service.test.ts` — 8/8 passed

| # | Test | Result |
|---|---|---|
| 1 | demo provider: retriever is never called; note = demo | ✅ PASS |
| 2 | live provider + default NoopRetriever (D1): no retrieval, note = disabled, provider gets no sources | ✅ PASS |
| 3 | live provider + enabled fake retriever: sources get server ids S1..Sn and reach the provider | ✅ PASS |
| 4 | retriever failure: answer continues without sources, note = failed | ✅ PASS |
| 5 | retriever timeout: aborted, answer continues without sources, note = timeout | ✅ PASS |
| 6 | retriever returning malformed items: invalid ones dropped; none left → no_results | ✅ PASS |
| 7 | more than 5 retrieved sources are capped at 5 | ✅ PASS |
| 8 | provider errors propagate unchanged (route maps them to HTTP) | ✅ PASS |

### `test/unit/knowledge-sources.test.ts` — 14/14 passed

| # | Test | Result |
|---|---|---|
| 1 | https-only: http, javascript:, data:, ftp, credentials and garbage URLs are rejected | ✅ PASS |
| 2 | server assigns ids S1..Sn; retriever cannot inject its own ids or extra fields | ✅ PASS |
| 3 | control and bidi-override characters stripped; long excerpts capped; duplicates dropped | ✅ PASS |
| 4 | empty title or excerpt after cleaning → dropped | ✅ PASS |
| 5 | demo → status demo, no sources, no citations, uncitedFacts 0 | ✅ PASS |
| 6 | live without retrieval (D1 default) → not_source_verified; AI-invented ids removed and disclosed | ✅ PASS |
| 7 | live with retrieved sources and a valid citation → source_backed; fabricated id removed | ✅ PASS |
| 8 | sources retrieved but nothing cited → still not_source_verified (no false claim) | ✅ PASS |
| 9 | connections are always marked as suggestions | ✅ PASS |
| 10 | hostile retrieved text cannot close the source block or add tags | ✅ PASS |
| 11 | hostile question cannot break out of the question block | ✅ PASS |
| 12 | neutralizeForPrompt strips control/bidi chars and caps length | ✅ PASS |
| 13 | system prompt forbids invented sources and treats sources as data | ✅ PASS |
| 14 | service.query with fake retriever + citing provider → source_backed with sanitized sources | ✅ PASS |

### `test/unit/learner-model.test.ts` — 15/15 passed

| # | Test | Result |
|---|---|---|
| 1 | no estimate before any graded answer | ✅ PASS |
| 2 | estimate is preliminary and low-confidence below 5 answers | ✅ PASS |
| 3 | uncertain results are ignored (never change the estimate) | ✅ PASS |
| 4 | results flagged countsTowardEstimate=false are ignored even if 'incorrect' | ✅ PASS |
| 5 | Elo maths: correct raises, incorrect lowers, partial in between | ✅ PASS |
| 6 | harder level counts more for a correct answer | ✅ PASS |
| 7 | rating maps to the four levels | ✅ PASS |
| 8 | corrupted storage is reset safely; clear() removes data | ✅ PASS |
| 9 | storage failures do not crash (e.g. storage disabled) | ✅ PASS |
| 10 | no personal data is stored: only topic label, rating, counts, timestamp | ✅ PASS |
| 11 | progress: empty input → zero totals, no topics | ✅ PASS |
| 12 | progress: weak topic with ≥2 answers → review, listed first | ✅ PASS |
| 13 | progress: a single wrong answer is not enough to flag review (low confidence → practice more) | ✅ PASS |
| 14 | progress: strong topic with enough answers → next level; advanced → keep | ✅ PASS |
| 15 | progress uses only stored data: estimates from the learner model round-trip | ✅ PASS |

### `test/unit/live-gate.test.ts` — 6/6 passed

| # | Test | Result |
|---|---|---|
| 1 | scripts/eval-grading.ts refuses without approval switches | ✅ PASS |
| 2 | scripts/eval-grading.ts refuses with a key but no SCIORA_ALLOW_LIVE_TESTS | ✅ PASS |
| 3 | scripts/eval-grading.ts refuses with approval switch but demo mode | ✅ PASS |
| 4 | scripts/live-smoke.ts refuses without approval switches | ✅ PASS |
| 5 | scripts/live-smoke.ts refuses with a key but no SCIORA_ALLOW_LIVE_TESTS | ✅ PASS |
| 6 | scripts/live-smoke.ts refuses with approval switch but demo mode | ✅ PASS |

### `test/unit/providers.test.ts` — 20/20 passed

| # | Test | Result |
|---|---|---|
| 1 | demo content: every file validates, passes integrity checks, and is marked unreviewed | ✅ PASS |
| 2 | demo content covers at least 3 subjects | ✅ PASS |
| 3 | demo-always-labelled: lessons carry simulated=true, source=demo, model=null and a DEMO caveat | ✅ PASS |
| 4 | demo: unknown topic → explicit not_in_demo error, never a made-up answer | ✅ PASS |
| 5 | demo: non-school level adds an honest caveat | ✅ PASS |
| 6 | demo grading: all keywords present → met with evidence found in answer → correct | ✅ PASS |
| 7 | demo grading: missing keywords → uncertain, NEVER incorrect (keywords miss paraphrases) | ✅ PASS |
| 8 | lesson request: Sonnet tier, medium effort, structured output, server-side fallback, fixed system prompt | ✅ PASS |
| 9 | model-routing: written grading uses the FAST tier (Haiku, low effort, no fallback param) | ✅ PASS |
| 10 | model-routing: escalation tier uses the LEARN model | ✅ PASS |
| 11 | fallbackUsed is reported when the API served a fallback model | ✅ PASS |
| 12 | refusal → ProviderError(refusal), no retry | ✅ PASS |
| 13 | max_tokens → one retry; success on retry is accepted | ✅ PASS |
| 14 | max_tokens twice → bad_output (partial output never shown) | ✅ PASS |
| 15 | schema-fail retry: invalid output then valid → ok; invalid twice → bad_output | ✅ PASS |
| 16 | SDK errors map to SCIORA errors (429, 401, connection, 5xx) | ✅ PASS |
| 17 | server-side fallback is requested only on models that support it | ✅ PASS |
| 18 | no-real-client-in-tests: demo config never creates an SDK client | ✅ PASS |
| 19 | live config creates exactly one client via the factory (fake here) with configured models | ✅ PASS |
| 20 | lesson integrity drops broken exercises with a caveat | ✅ PASS |

### `test/unit/replay-store.test.ts` — 12/12 passed

| # | Test | Result |
|---|---|---|
| 1 | reserve → complete → repeat returns the ORIGINAL result, never a new grading | ✅ PASS |
| 2 | PENDING record answers in_progress with retryAfter 2 | ✅ PASS |
| 3 | failed-grade-same-answer-retry-ok / different-answer-locked | ✅ PASS |
| 4 | stale-pending-recovers: PENDING past timeout becomes FAILED_RETRYABLE, answer stays locked | ✅ PASS |
| 5 | capacity-never-evicts-unexpired: full store refuses, every existing record survives | ✅ PASS |
| 6 | capacity-retry-after-header: retryAfter equals time until the oldest record may be removed | ✅ PASS |
| 7 | capacity-cleans-expired-first: expired records are removed, then reservation succeeds | ✅ PASS |
| 8 | records inside the clock-skew window are NOT considered expired | ✅ PASS |
| 9 | capacity-blocks-learn-at-high-water: new sets refused at 90%, allowed after expiry | ✅ PASS |
| 10 | concurrent-20-requests-one-grade (store level): only one of 20 interleaved reserves wins | ✅ PASS |
| 11 | sweep removes only expired records | ✅ PASS |
| 12 | answer hasher: deterministic, keyed, and does not contain the answer | ✅ PASS |

### `test/unit/rubric-aggregate.test.ts` — 13/13 passed

| # | Test | Result |
|---|---|---|
| 1 | all required met → correct (optional unmet lowers score only) | ✅ PASS |
| 2 | some required met → partially_correct with score | ✅ PASS |
| 3 | partial judgement on a required criterion → partially_correct | ✅ PASS |
| 4 | all required clearly not_met → incorrect, misconception mapped | ✅ PASS |
| 5 | fabricated evidence → criterion downgraded to unclear → uncertain (never correct) | ✅ PASS |
| 6 | met without any evidence → unclear → uncertain | ✅ PASS |
| 7 | required criterion explicitly unclear → uncertain | ✅ PASS |
| 8 | criterion missing from AI output → unclear → uncertain | ✅ PASS |
| 9 | low AI confidence → uncertain even if all met | ✅ PASS |
| 10 | unclear OPTIONAL criterion does not make the verdict uncertain | ✅ PASS |
| 11 | unknown criterion ids from the AI are ignored | ✅ PASS |
| 12 | evidence check tolerates tashkeel, alef forms and punctuation differences | ✅ PASS |
| 13 | rubric with no required criteria treats all criteria as required | ✅ PASS |

### `test/unit/schemas.test.ts` — 8/8 passed

| # | Test | Result |
|---|---|---|
| 1 | sample lesson satisfies the GeneratedLesson schema | ✅ PASS |
| 2 | public view contains no answer-key fields (deep key scan) | ✅ PASS |
| 3 | public view contains none of the sealed marker strings | ✅ PASS |
| 4 | public view keeps what students need: prompts, choices, hints | ✅ PASS |
| 5 | public view ignores extra fields injected into sealed objects (whitelist) | ✅ PASS |
| 6 | LessonRequest: defaults, trimming and limits | ✅ PASS |
| 7 | GradeRequest: limits and strictness | ✅ PASS |
| 8 | WrittenJudgement schema rejects unknown judgement values | ✅ PASS |

### `test/api/api.test.ts` — 31/31 passed

| # | Test | Result |
|---|---|---|
| 1 | health (demo): mode demo, simulated, no models, demo topics listed, nothing secret | ✅ PASS |
| 2 | health (live stub): mode live with configured models | ✅ PASS |
| 3 | demo lesson via HTTP is labelled simulated with a DEMO caveat | ✅ PASS |
| 4 | live-failure-not-replaced-by-demo: provider error → error response, no lesson | ✅ PASS |
| 5 | demo unknown topic → 404 not_in_demo | ✅ PASS |
| 6 | answer-key-not-in-response: no forbidden keys, no sealed text, anywhere in /api/learn output | ✅ PASS |
| 7 | answer-key-not-in-response (demo content): demo answers/model answers absent from response | ✅ PASS |
| 8 | input validation: bad bodies → 400 with field names only | ✅ PASS |
| 9 | body larger than 32 KB → 413 | ✅ PASS |
| 10 | unknown API endpoint → JSON 404 | ✅ PASS |
| 11 | mcq: correct answer graded, correct answer revealed after attempt | ✅ PASS |
| 12 | replay-returns-original: grade A (wrong) then B → 409 with ORIGINAL result; B never graded | ✅ PASS |
| 13 | invalid mcq choice → 400 and does NOT consume the attempt | ✅ PASS |
| 14 | numeric: Eastern Arabic decimal accepted; unreadable → 422 without consuming the attempt | ✅ PASS |
| 15 | expression: equivalent form 2(x+1) accepted for 2*x+2 | ✅ PASS |
| 16 | forged / tampered / malformed tokens → 400 invalid_token; unknown exercise → 400 | ✅ PASS |
| 17 | expired token → 410 token_expired | ✅ PASS |
| 18 | short_text correct via rubric AI (fast tier) | ✅ PASS |
| 19 | short_text uncertain: explained, does not count toward estimate, escalation OFF → one call | ✅ PASS |
| 20 | escalation ON: uncertain Haiku result is re-graded once by the LEARN model | ✅ PASS |
| 21 | grading failure: 503, then different answer → 409 answer_locked, same answer → graded | ✅ PASS |
| 22 | concurrent-20-requests-one-grade: 20 simultaneous different answers → grader runs exactly once | ✅ PASS |
| 23 | mcq-also-reserved: 10 simultaneous MCQ submissions → exactly one graded | ✅ PASS |
| 24 | capacity: full store → grading 503 'NOT graded' with Retry-After; existing records untouched | ✅ PASS |
| 25 | capacity-blocks-learn-at-high-water: /api/learn → 503 before calling the AI | ✅ PASS |
| 26 | daily limit (live only): second lesson refused with daily_limit | ✅ PASS |
| 27 | daily limit does not apply to demo mode (no AI cost) | ✅ PASS |
| 28 | rate limit: requests beyond the per-minute limit → 429 | ✅ PASS |
| 29 | security headers: strict CSP, nosniff, no framing, no CORS | ✅ PASS |
| 30 | static: index served; server source and demo answer files are NOT served | ✅ PASS |
| 31 | no-secret-in-logs: tokens, answers, secrets and keys never appear in logs | ✅ PASS |

### `test/api/evidence-api.test.ts` — 10/10 passed

| # | Test | Result |
|---|---|---|
| 1 | health reports the evidence module (demo, no retrieval, 5 demo claims) | ✅ PASS |
| 2 | demo analysis: insufficient_evidence, basis none, no sources, DEMO caveat | ✅ PASS |
| 3 | demo opinion → not_checkable; unknown claim → 404 not_in_demo | ✅ PASS |
| 4 | live (fake), no retrieval: invented evidence removed → insufficient_evidence | ✅ PASS |
| 5 | live (fake) + FAKE retriever: verified quote → contradicted with https source | ✅ PASS |
| 6 | live failure → error, never demo content | ✅ PASS |
| 7 | validation: bad bodies → 400; oversized → 413 | ✅ PASS |
| 8 | no prompt, secret or key in responses; claim text not in logs | ✅ PASS |
| 9 | shared daily limit covers evidence calls (live); demo calls are free | ✅ PASS |
| 10 | rate limit and security headers apply | ✅ PASS |

### `test/api/knowledge-api.test.ts` — 17/17 passed

| # | Test | Result |
|---|---|---|
| 1 | health reports the knowledge module: demo, no retrieval, demo topics; Explorer not 'planned' | ✅ PASS |
| 2 | demo query: 200, status demo, no sources, DEMO caveat, suggestions labelled | ✅ PASS |
| 3 | demo query in Arabizi and English is understood | ✅ PASS |
| 4 | demo unknown topic → 404 not_in_demo | ✅ PASS |
| 5 | live (fake client), no retrieval (D1): not_source_verified, invented citation removed and disclosed | ✅ PASS |
| 6 | live (fake client) + FAKE retriever: source_backed with sanitized https sources only | ✅ PASS |
| 7 | live failure is an error, never replaced by demo content | ✅ PASS |
| 8 | malformed provider output twice → 502 bad_output | ✅ PASS |
| 9 | transform (demo): simplify / examples / quiz; quiz flagged self-check, no token | ✅ PASS |
| 10 | transform validation: bad mode, extra fields, oversized content → 400 | ✅ PASS |
| 11 | transform content is treated as data: hostile content neutralized in the prompt | ✅ PASS |
| 12 | query validation: bad bodies → 400; too large → 413 | ✅ PASS |
| 13 | no internal prompt, secret or key ever appears in knowledge responses | ✅ PASS |
| 14 | shared daily budget: live knowledge calls count against SCIORA_DAILY_LIMIT; demo calls do not | ✅ PASS |
| 15 | rate limit applies to knowledge routes | ✅ PASS |
| 16 | security headers present on knowledge routes; no CORS | ✅ PASS |
| 17 | logs never contain the question text or retrieved excerpts | ✅ PASS |

### `test/e2e/evidence.e2e.test.ts` — 6/6 passed

| # | Test | Result |
|---|---|---|
| 1 | demo: factual claim → insufficient evidence, honest basis banner, background labelled not evidence | ✅ PASS |
| 2 | demo: opinion → not checkable; compound claim → two sub-claims | ✅ PASS |
| 3 | demo claim chips fill the claim box; unknown claim shows a localized error | ✅ PASS |
| 4 | no English leakage in the evidence interface text | ✅ PASS |
| 5 | FAKE live provider + FAKE retriever: verified quote shown with source link; verdict contradicted | ✅ PASS |
| 6 | mobile: evidence panel without horizontal overflow | ✅ PASS |

### `test/e2e/explorer.e2e.test.ts` — 7/7 passed

| # | Test | Result |
|---|---|---|
| 1 | explorer demo flow: labelled answer, no sources, suggestions, learning mode, save card | ✅ PASS |
| 2 | explorer: unknown topic in demo shows a localized error, no invented content | ✅ PASS |
| 3 | no English leakage in explorer and cards interface text (content excluded) | ✅ PASS |
| 4 | tabs support keyboard navigation (RTL arrows), in DOM order with wrap-around | ✅ PASS |
| 5 | tampered cards in localStorage render safely (no javascript: links, status downgraded) | ✅ PASS |
| 6 | mobile: explorer renders in RTL without horizontal overflow | ✅ PASS |
| 7 | FAKE live provider + FAKE retriever: AI label, source_backed banner, safe https source links | ✅ PASS |

### `test/e2e/progress.e2e.test.ts` — 4/4 passed

| # | Test | Result |
|---|---|---|
| 1 | empty progress: honest empty state, zero stats | ✅ PASS |
| 2 | progress reflects real graded answers; weak topic flagged; practice button returns to learning | ✅ PASS |
| 3 | saved cards are counted; clearing my data empties progress | ✅ PASS |
| 4 | no English leakage in progress interface; mobile without overflow | ✅ PASS |

### `test/e2e/workspace.e2e.test.ts` — 5/5 passed

| # | Test | Result |
|---|---|---|
| 1 | demo flow: question → labelled lesson → exercises → feedback → preliminary estimate | ✅ PASS |
| 2 | uncertain written answer is explained and not counted in the estimate | ✅ PASS |
| 3 | unknown topic in demo mode shows an honest message, not invented content | ✅ PASS |
| 4 | mobile layout renders the workspace in RTL without horizontal overflow | ✅ PASS |
| 5 | clear my data removes the stored estimate | ✅ PASS |

## Known limitations

- Phase 1: in-memory replay store (single process; restart clears it); numeric parser does not evaluate roots; conservative demo keyword grading; 37 unreviewed fixtures.
- Phase 2A: no real retrieval; demo knowledge content Darija-only, one level; cards browser-local and user-editable.
- Phase 2B: no real retrieval, so verdicts other than *insufficient evidence* / *not checkable* occur only with the fake test retriever; demo analyses are Darija-only and unreviewed.
- Learning Progress: shows only browser-stored data; recommendations are simple rules, not diagnoses.
- Cosmetic: mixed Arabic/Latin topic names with parentheses can render with misplaced brackets when wrapped in the narrow side panel (browser bidi line-wrapping).
