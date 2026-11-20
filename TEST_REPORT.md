# SCIORA — Test Report

_Only tests that were actually executed are listed. Every row below was produced by running the test file; nothing is copied from expectations._

## Run summary

| Item | Value |
|---|---|
| Date | 2026-11-20 |
| Code version | commit `11e0f62` + documentation changes (no code changes after this run) |
| Environment | Linux container, Node 22.23.5, Chromium (pre-installed Playwright) |
| AI mode during tests | **Demo mode or a fake AI client. No real API call was made.** |
| Automated tests | **154 / 154 passed**, 0 failed, 0 skipped |
| `npm test` (unit + API) | 149 / 149 passed |
| `npm run test:e2e` (browser) | 5 / 5 passed |
| `npm run typecheck` | passed (0 errors) |
| `npm audit` | 0 vulnerabilities (all and production dependencies) |
| Secret scan | passed (no key patterns, no `.env` files) |
| Manual server smoke (`npm start`, demo) | health → demo mode; lesson generated (water cycle); MCQ graded; index served |
| Production start without `SCIORA_TOKEN_SECRET` | refused to start (exit 1), as designed |

## NOT executed (and why)

| Test | Expected | Actual | Status |
|---|---|---|---|
| `npm run test:live` (real lesson + grading call) | Live API works end to end | — | **Not run** — requires owner approval and an API key |
| `npm run eval:grading` (Haiku on 28 written fixtures) | 0 correct answers graded incorrect; ≥ 90% agreement | — | **Not run** — requires owner approval; costs money |
| Structured outputs + server-side fallback combined, live | Accepted by the API | — | **Unverified** |
| Darija quality of live explanations | Natural, correct Darija | — | **Not evaluated** (needs live mode + native-speaker review) |
| Owner review of demo lessons and fixture labels | Reviewed | All marked unreviewed | **Pending** |

## What the tests prove — and what they do not

- **Prove:** the server never sends answer keys to the browser; tokens cannot be read, forged, tampered with or used after expiry; each exercise is graded once even under 20 simultaneous requests; the store fails closed when full without evicting records; rule-based grading accepts equivalent answers (`1/2`, `0.5`, `٠٫٥`, `2(x+1)`); the server-side verdict rule turns doubtful or unsupported AI judgements into *uncertain*; demo content is always labelled and never replaces a failed live call; secrets and answers never appear in logs; the UI works in RTL on desktop and mobile without console/CSP errors.
- **Do not prove:** that Claude Haiku judges Darija answers correctly, or that Claude Sonnet writes good Darija explanations. The grading fixture tests use *recorded* judgements to test SCIORA's code; model quality needs the live evaluation.

## Detailed results

### Configuration (demo/live switch, secrets, model routing)
`test/unit/config.test.ts` — 13/13 passed

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

### Encrypted exercise tokens (AES-256-GCM)
`test/unit/exercise-token.test.ts` — 15/15 passed

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

### Rule-based grading and Arabic normalization
`test/unit/grading-deterministic.test.ts` — 15/15 passed

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

### Grading fixtures (37 cases, offline pipeline)
`test/unit/grading-fixtures.test.ts` — 6/6 passed

| # | Test | Result |
|---|---|---|
| 1 | fixture set: ≥30 cases, ≥3 subjects, all required categories present | ✅ PASS |
| 2 | fixture sanity: every met/partial evidence quote really appears in its answer | ✅ PASS |
| 3 | pipeline: every fixture case produces its expected verdict | ✅ PASS |
| 4 | pipeline safety: no CORRECT-category answer is ever graded incorrect | ✅ PASS |
| 5 | demo keyword grader safety on fixtures: never 'incorrect', never a false 'correct' | ✅ PASS |
| 6 | review status is reported honestly (owner review still pending) | ✅ PASS |

### Preliminary level estimate (learner model)
`test/unit/learner-model.test.ts` — 10/10 passed

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

### Live-call guards (scripts refuse without approval)
`test/unit/live-gate.test.ts` — 6/6 passed

| # | Test | Result |
|---|---|---|
| 1 | scripts/eval-grading.ts refuses without approval switches | ✅ PASS |
| 2 | scripts/eval-grading.ts refuses with a key but no SCIORA_ALLOW_LIVE_TESTS | ✅ PASS |
| 3 | scripts/eval-grading.ts refuses with approval switch but demo mode | ✅ PASS |
| 4 | scripts/live-smoke.ts refuses without approval switches | ✅ PASS |
| 5 | scripts/live-smoke.ts refuses with a key but no SCIORA_ALLOW_LIVE_TESTS | ✅ PASS |
| 6 | scripts/live-smoke.ts refuses with approval switch but demo mode | ✅ PASS |

### AI providers (demo; Anthropic with FAKE client)
`test/unit/providers.test.ts` — 20/20 passed

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

### Replay store (atomic reservation, fail-closed capacity)
`test/unit/replay-store.test.ts` — 12/12 passed

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

### Rubric aggregation and evidence check
`test/unit/rubric-aggregate.test.ts` — 13/13 passed

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

### Schemas and public (browser-safe) view
`test/unit/schemas.test.ts` — 8/8 passed

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

### HTTP API (security, transparency, concurrency, capacity)
`test/api/api.test.ts` — 31/31 passed

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

### Browser end-to-end (Playwright, demo mode)
`test/e2e/workspace.e2e.test.ts` — 5/5 passed

| # | Test | Result |
|---|---|---|
| 1 | demo flow: question → labelled lesson → exercises → feedback → preliminary estimate | ✅ PASS |
| 2 | uncertain written answer is explained and not counted in the estimate | ✅ PASS |
| 3 | unknown topic in demo mode shows an honest message, not invented content | ✅ PASS |
| 4 | mobile layout renders the workspace in RTL without horizontal overflow | ✅ PASS |
| 5 | clear my data removes the stored estimate | ✅ PASS |

## Failures found during development (and fixed)

See `DEVELOPMENT_LOG.md` → Phase 1 implementation: expression whitelist bug, superscript normalization order, a 1-character demo keyword, a missing Darija keyword, a key-shaped test value blocked by the secret scan, and English text in the Arabic UI. Each gate was re-run after the fix.

## Known limitations

- Replay store is in memory: a restart clears it (tokens issued before the restart could be re-graded until they expire, max 2 h); atomic within one Node process only.
- Numeric parser does not evaluate roots/expressions (e.g. `√169`); such answers get a 422 "rewrite your answer" message without consuming the attempt (fixture `py-num-6`).
- Demo keyword grading is deliberately conservative: it often returns *uncertain* for correct paraphrases (never *incorrect*).
- 37 fixtures is a small sample; labels are not yet reviewed by a native speaker.
