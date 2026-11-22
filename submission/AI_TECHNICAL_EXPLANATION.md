# SCIORA — AI Technical Explanation

_Describes the code on branch `feature/groq-free-provider` (2026-11-21). "Verified" means covered by automated tests that were run (all with simulated API responses), plus one first controlled live test with Groq described in §10._

## 0. Language policy (English-only)
SCIORA is an English-only AI learning and knowledge platform designed for an international audience.
- **Interface:** one English dictionary, left-to-right layout, no language switcher or language selectors.
- **Input:** a conservative check flags text that is *clearly* not English (mostly non-Latin script, or several French/Spanish/Arabizi function words with no English ones) and replies with “SCIORA currently supports English only. Please submit your question in English to continue.” It accepts English with scientific terms, names, Greek symbols, formulas and code. Numbers and expressions are never language-checked.
- **AI prompts:** every system prompt (lessons, grading, Knowledge Explorer, transforms, Evidence Analyzer) contains the same mandatory English-only rule.
- **AI output:** every live AI response is checked for clearly non-English or mixed-language prose; it is retried once at most, then rejected with an English error. Quotes copied from sources are exempt (external content).
- **Retrieval:** English Wikipedia only.

## 1. AI architecture

```
Browser (HTML/JS, no secrets)
   │  HTTPS, JSON
   ▼
SCIORA server (Node.js + Fastify + TypeScript)
   ├─ validation (zod) · rate limit · daily AI cap · security headers · log redaction
   ├─ Learning Assistant ─┐
   ├─ Knowledge Explorer ─┼─► Provider (chosen on the server)
   ├─ Evidence Analyzer ──┘     ├─ Demo provider      (default, pre-written, no AI)
   │                            ├─ Anthropic Claude   (paid; built, not run live)
   │                            └─ Groq open models   (free tier; built, not run live)
   ├─ Wikipedia retriever (free MediaWiki API, fixed hosts)
   └─ Server-side checks: rule grading, rubric aggregation, quote checks, verdicts
```

- **Provider abstraction:** every feature talks to an interface (`AIProvider`, `KnowledgeProvider`, `EvidenceProvider`), never to a vendor directly. `SCIORA_AI_MODE` (`demo` | `live`) and `SCIORA_AI_PROVIDER` (`anthropic` | `groq`) select the implementation. Live mode needs the selected provider's key, and a key alone never turns live mode on.
- **No silent fallback:** if live AI fails, the student sees an error ("busy, try again", "not configured"), never demo content pretending to be AI.
- **Model routing (configurable):** Anthropic uses `claude-sonnet-5-5` (lessons, knowledge), `claude-haiku-5-5` (grading, transforms) and `claude-opus-5-5` (evidence). Groq uses `openai/gpt-oss-120b` for all three tiers by default.

## 2. Knowledge Intelligence (Knowledge Explorer)
1. The question is validated and neutralized (see §7).
2. The server retrieves up to 5 Wikipedia excerpts (if online) and assigns them IDs `S1`–`S5`.
3. The model returns a structured answer: summary, **segments labelled `fact` / `explanation` / `assumption` / `uncertainty`**, key concepts and related concepts (labelled as suggestions).
4. The server removes any source ID that was not retrieved, discloses the removal, and decides the **verification status** itself: `demo`, `not_source_verified` or `source_backed`.
5. Learning mode can turn an answer into a simpler explanation, examples or a short self-check quiz (checked in the browser, not recorded).

## 3. Evidence Intelligence (Evidence Analyzer)
1. The model restates the claim and splits it into up to 6 sub-claims, typed `factual`, `opinion`, `prediction`, `value_judgment` or `ambiguous`.
2. For factual sub-claims it may propose evidence: a source ID, a stance (supports / contradicts / context) and an **exact quote**.
3. The **server keeps a quote only if it really appears in that retrieved excerpt**, then computes each verdict: supported, contradicted, mixed, insufficient evidence or not checkable, plus an overall verdict (which can also be "partially supported").
4. AI general knowledge appears only as a separate note labelled **"background — not evidence"**.
5. Keyword-matched passages from sources can be shown for the student to inspect; they are not counted as evidence.

## 4. Adaptive learning
- After each lesson, the student answers 3 exercises; a **session summary** recommends the next step: *next level* (all correct), *practise the same level*, or *review the explanation first*.
- An **Elo-style rating per topic** (`expected = 1 / (1 + 10^((difficulty − rating)/400))`) updates only from real graded answers; "uncertain" results are ignored. It is shown as a **preliminary estimate**, stored only in the student's browser.

## 5. Structured outputs
- Every AI response must be JSON matching a strict schema (lesson, judgement, knowledge answer, simplify, examples, quiz, claim analysis).
- **Anthropic:** structured outputs (`output_config.format`) generated from the zod schemas.
- **Groq:** strict JSON-schema mode. SCIORA converts each zod schema with zod's own `z.toJSONSchema`, then adapts it to the keywords Groq documents for strict mode: unions become `anyOf`, literals and exact single-character patterns (e.g. quiz choice ids `a`–`d`) become `enum`s, and other length/pattern rules move into descriptions. Conversion happens at request time and is cached.

## 6. Validation
- **Every AI response is validated again on the server with the original zod schema**, whatever the provider. Invalid output is retried at most once; cut-off output (the model ran out of tokens) is rejected without a retry; refusals are reported as refusals. Partial or invalid output is never shown.
- A **lesson integrity check** removes broken exercises (for example a multiple-choice question whose correct answer is not among the choices) and tells the student.
- Answer keys are sealed in an **AES-256-GCM encrypted exercise token** (with expiry); the browser never sees correct answers before grading. A **replay store** prevents re-grading the same exercise with a different answer.

## 7. Safety
- **Prompt-injection hygiene:** student questions, written answers, claims and retrieved text are placed inside delimiter tags after neutralization: `<` and `>` become look-alike characters (so text cannot close a tag), invisible control/bidi characters are removed, and length is capped. System prompts tell the model that tagged text is data, never instructions.
- **No invented sources or evidence:** enforced by the server (§2, §3), not by trust in the model.
- **Secrets:** API keys are read only on the server from environment variables, never sent to the browser, never logged (log redaction + tests), and `.env` files are git-ignored; a secret scan runs before commits.
- **Abuse and cost limits:** per-IP rate limit (default 30 requests/minute), optional daily AI cap (`SCIORA_DAILY_LIMIT`), 32 KB request limit, response-size cap (1 MiB) and timeouts for live AI calls. Demo mode makes no AI calls.
- **Privacy:** no accounts, no database; progress and cards stay in the student's browser.

## 8. Deterministic grading
- **Multiple choice:** exact choice match.
- **Numeric:** parses `0.5`, `1/2`, Arabic-Indic digits (`٠٫٥`), percentages where allowed, with a tolerance.
- **Algebraic expressions:** evaluated safely with a restricted math parser and compared at several points (`2(x+1)` = `2x+2`).
- **Written answers:** the AI judges each rubric criterion (met / partial / not met / unclear) and must quote the student; the **server** checks each quote, aggregates the score and decides the verdict. If a required criterion is unclear, the verdict is **uncertain**, which never counts against the student.
- The AI is never used for multiple-choice, numeric or expression answers, and it cannot override a rule-based result.

## 9. AI limitations
- Language models can be wrong; every AI result is labelled "AI-generated (model) · may contain mistakes".
- Prompt-injection hygiene protects the prompt structure but cannot guarantee how a model behaves.
- English-language checks are heuristics: they catch clearly non-English or mixed-language text but cannot guarantee perfect English.
- Wikipedia is the only source; coverage and accuracy vary, and it is never treated as sufficient proof alone.
- The level estimate is a rough, preliminary signal.
- SCIORA does not train or fine-tune models.

## 10. Demo versus live status
| Part | Status |
|---|---|
| Demo mode (5 topics, 5 claims; English only) | **Implemented and tested** (unit, API and browser tests). Content not yet reviewed by a teacher. |
| Rule-based grading, rubric aggregation, quote checks, verdicts, tokens, replay protection | **Implemented and tested** |
| Wikipedia retrieval | **Implemented**; tested with simulated responses and checked manually against the real API during development |
| Live AI — Anthropic Claude | **Built; tested only with simulated API responses.** Never run against the real API. |
| Live AI — Groq (free tier) | **First controlled live test passed (2026-11-21, English, `openai/gpt-oss-120b`):** all 6 AI calls completed; Groq accepted every strict schema; the wrong answer was graded incorrect, knowledge citations pointed only to retrieved Wikipedia sources, and the evidence verdict was honestly "insufficient evidence" when no source was found. The free-tier rate limit was hit after 4 back-to-back calls. Teacher review of live content pending. Requires an adult account holder. |
| Google Sign-In | Planned, not implemented |

Test totals for this version (run 2026-11-22): 402 unit/API tests and 37 browser tests, all passing (see the current summary at the top of `TEST_REPORT.md`; the earlier detailed report).
