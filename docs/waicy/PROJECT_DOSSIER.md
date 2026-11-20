# SCIORA — Project Dossier (WAICY 2026 · AI Showcase)

_Source document for the submission description, slides, demo video and judge Q&A.
Everything here describes the implemented and tested project (see `TEST_REPORT.md`). Nothing has been submitted yet._

---

## 1. Project overview
**SCIORA — Global Knowledge & Learning Intelligence** is an AI learning and knowledge platform for students. It combines three connected tools:

| Tool | What it does |
|---|---|
| **Learning Assistant** (Darija AI Study) | Explains Moroccan school topics in Moroccan Darija and Arabic (or French), gives worked examples and exercises, grades answers and explains mistakes, then summarizes the session and suggests the next step. |
| **Knowledge Explorer** | Answers questions with every part labelled as fact, explanation, assumption or uncertainty; shows retrieved sources (Wikipedia) and says clearly when an answer is not source-verified. Answers can become simpler explanations, examples, quizzes or saved knowledge cards. |
| **Evidence Analyzer** | Splits a claim into parts, separates checkable facts from opinions and predictions, and judges each part only on quotes found in retrieved sources: Supported / Partially supported / Contradicted / Mixed / Insufficient evidence / Not checkable. |

The interface is English by default (international audience) with an optional Arabic interface. Learning and AI response languages (Darija, Modern Standard Arabic, French, English, and Arabizi input) are chosen separately.

## 2. Problem statement
- Many Moroccan students speak Darija at home but study in Modern Standard Arabic and French. Explanations in the language they think in can help understanding. _(Qualitative observation; no statistics are claimed.)_
- AI chatbots can produce confident but wrong answers and invented references. Students need to see **what is verified, what is explained, and what is uncertain**.
- Students also need to practise **evaluating claims against evidence**, not only receiving answers.

## 3. Solution
SCIORA treats honesty as a feature:
- **Transparency labels** on every result: demo vs AI-generated, model name, and verification status.
- **The server, not the AI, decides** grades and evidence verdicts, using rules and checks the student can understand.
- **No invented sources:** the AI's output format has no fields for titles or links; only sources actually retrieved by the server can be cited, and evidence must be an exact quote found in the source.
- **Uncertainty is a result:** "uncertain" grades and "insufficient evidence" verdicts are shown and explained instead of guessed.

## 4. Target users
Middle- and high-school students (initial focus: Morocco), who may be multilingual and use Darija, Arabic, French or English. Teachers can use it as a classroom aid. _(No user numbers are claimed; SCIORA has not been deployed publicly.)_

## 5. AI functionality (what genuinely works)
| Capability | Status |
|---|---|
| Lesson generation in Darija + formal Arabic/French (Claude Sonnet 5.5) | **Implemented; tested with a fake AI client only** — no live API call has been made yet |
| Rubric-based grading of written answers (Claude Haiku 5.5) with server-side verdict and evidence check | Implemented; tested offline (37 fixture cases) and with a fake client |
| Knowledge answers with typed segments and source citations (Sonnet 5.5) | Implemented; fake-client tested |
| Claim splitting, classification and evidence quoting (Claude Opus 5.5) | Implemented; fake-client tested |
| Rule-based grading (multiple choice, numbers incl. `1/2 = 0.5 = ٠٫٥`, algebraic equivalence) | **Works now, no AI needed** |
| Wikipedia retrieval (free MediaWiki API) | **Works now**; checked manually against the real API (English results; Arabic was rate-limited from the development server) |
| Adaptive level estimate (Elo-style) and progress recommendations | **Works now**, from the student's own graded answers |
| Demo mode with pre-written content | **Works now**, always labelled DEMO |

**Five Big Ideas of AI (AI4K12), honestly mapped:**
- *Perception* — not implemented.
- *Representation & Reasoning* — typed answer segments, rubrics, claim/sub-claim structures, rule-based maths reasoning, server-side verdict rules.
- *Learning* — SCIORA does **not** train a model. Its adaptive component is an Elo-style estimate updated from the student's graded answers.
- *Natural Interaction* — questions and answers in Darija, Arabic, French, English and Arabizi.
- *Societal Impact* — transparency labels, uncertainty, privacy-by-design, ethics documentation.

## 6. AI architecture
```
Student ─► SCIORA server ─► (optional) Wikipedia retrieval ─► Claude model (structured JSON output)
                    │                                              │
                    └──────── server-side checks ◄─────────────────┘
       grading rules · rubric aggregation · quote-in-source verification · verdict rules
```
- **Provider abstraction:** every tool has a demo provider and an Anthropic provider; the rest of the code never calls an AI vendor directly.
- **Model routing:** Sonnet 5.5 (lessons, knowledge answers), Haiku 5.5 (grading, transforms), Opus 5.5 (evidence analysis). All configurable.
- **Structured outputs:** responses must match strict schemas and are validated again on the server; invalid or cut-off output is retried once, then reported as an error — never shown half-finished.
- **Prompt-injection defence:** student text and retrieved text are treated as data inside delimited blocks; tag characters and control characters are neutralized.
- **Live mode is opt-in** (`SCIORA_AI_MODE=live` + key); a live failure is never replaced by demo content.

## 7. Technical architecture
Node.js 22 · Fastify · TypeScript · zod · vanilla JavaScript front end (no build step) · Playwright tests.
- **Security:** encrypted exercise answer keys (AES-256-GCM), one graded attempt per exercise with atomic reservation, fail-closed capacity, strict Content-Security-Policy, rate limiting, input validation, log redaction, secret scanning before every commit.
- **Privacy:** no accounts, no names or emails; progress and knowledge cards stay in the student's browser.
- **Retrieval:** fixed Wikipedia hosts only, throttling, caching, bounded retries with backoff, timeouts, untrusted-content validation; no invented publication dates.
- Details: `PROJECT_ARCHITECTURE.md`.

## 8. Innovation
1. **Verdicts by rules, not by the model.** The AI proposes; the server verifies (exact quotes in retrieved text, rubric evidence in the student's answer).
2. **"Not checkable" and "insufficient evidence" as first-class answers**, teaching students that opinions and predictions are not facts and that missing evidence is not proof of falsehood.
3. **Darija-first learning** with fair grading of Darija, Arabizi, French and misspelled answers (meaning over wording; doubtful cases become "uncertain", never "incorrect").
4. **Connected workflow:** learn → practise → evaluate → improve, and explore → check a claim → inspect the source.

## 9. Impact (intended — not measured)
SCIORA aims to help students understand concepts in the language they think in, practise with honest feedback, and build the habit of checking claims against sources. **No impact has been measured**; SCIORA has not been used by real students yet.

## 10. Ethical considerations
See `AI_ETHICS.md`. Key points: hallucination risk is disclosed on every AI card; no fabricated citations; Wikipedia is never presented as sufficient proof on its own; uncertain grades do not affect the level estimate; no personal data is collected; demo content is clearly labelled and not yet reviewed by the project owner.

## 11. Limitations (honest)
- **No live AI call has been made yet.** AI features are tested with a fake client; real model quality (especially Darija) is unverified.
- Demo content (5 lessons, 5 knowledge answers, 5 evidence analyses) is pre-written, Darija-only and **not yet reviewed** by the project owner.
- Wikipedia only (intro extracts); rate limits can block retrieval from shared servers. In demo mode, "Check this claim" only works for the five demo claims.
- The level estimate is a simple Elo-style rule, not a validated assessment.
- In-memory replay protection (single server process). No accounts or synced progress. No French interface.

## 12. Testing methodology
- **Unit tests:** grading rules, encryption, replay protection, verdict rules, retrieval parsing, i18n dictionaries, learner model, session summary.
- **API tests:** every endpoint with security checks (answer-key leakage, forged/expired tokens, concurrency, capacity, rate limits, log privacy).
- **Browser tests (Playwright):** real user journeys in English and Arabic, desktop and mobile, keyboard navigation, RTL layout.
- **Fakes, not the internet:** automated tests never call the AI API or Wikipedia; a fake AI client and a fake fetch are used. Live checks are separate, gated scripts.

## 13. Testing results
See `TEST_REPORT.md` for the exact, executed results (tests listed one by one). No test is reported unless it was run.

## 14. Development journey
1. **Phase 0–1:** workspace audit; three plan revisions with the project owner (encrypted tokens, fail-closed replay store, fair Darija grading); Darija AI Study learning loop.
2. **Phase 2A:** Knowledge Explorer with source transparency and knowledge cards.
3. **Phase 2B:** Evidence Analyzer with server-side verdicts; Learning Progress screen.
4. **International release:** English-first interface (Arabic optional); real Wikipedia retrieval.
5. **Sprint:** professional redesign (sidebar app shell), "partially supported" verdict, keyword-matched passages to inspect, session summary, Knowledge → Evidence workflow.

All code was written with the help of Claude (Anthropic) via Claude Code under the student's direction — see `AI_USAGE_DISCLOSURE.md`.
