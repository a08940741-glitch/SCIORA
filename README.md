# SCIORA — Global Knowledge & Learning Intelligence

**WAICY 2026 · AI Showcase · Individual · Grade 7 · Morocco**

SCIORA is an AI-assisted learning platform. Its first implementation, **Darija AI Study**, helps Moroccan students understand school topics in Moroccan Darija and Arabic, practise with exercises, and get honest, explained feedback.

> **Current status: Phase 1 (learning loop), Phase 2A (Knowledge Explorer) and Phase 2B (Evidence Analyzer) implemented and tested in demo mode.**
> Live AI mode is built but has **not yet been run against the real API** (no live calls without the project owner's approval).
> **Interface:** English by default (international design); an Arabic (Darija) interface is optional. Learning and AI response languages (Darija, MSA, French, English) are chosen separately in each tool.
> **Sources:** real retrieval from the free public **Wikipedia (MediaWiki) API**. In demo mode retrieved articles are shown only as related reading; Wikipedia alone is never presented as sufficient proof.
> A **Learning Progress** screen (browser data only) is implemented. Optional Google Sign-In is **planned, not implemented.**
> See [`FEATURE_STATUS.md`](FEATURE_STATUS.md).

## What Phase 1 does

```
Question → Understanding → Explanation (Darija + formal) → Example → Exercises → Grading → Feedback → Preliminary level estimate
```

- **Explanations** in Moroccan Darija plus a formal explanation (Modern Standard Arabic or French).
- **Four exercise types:** multiple choice, numeric, algebraic expression, written answer.
- **Grading that explains itself:**
  - multiple choice, numbers and expressions are graded by **rules** (no AI): `1/2 = 0.5 = ٠٫٥`, `2(x+1) = 2x+2`;
  - written answers are judged **criterion by criterion** against a rubric; the **server** decides the verdict and checks that the AI's quoted evidence really appears in the student's answer;
  - verdicts: correct / partially correct / incorrect / **uncertain** — SCIORA says when it is not sure, and uncertain results never count against the student.
- **Transparency:** every card is labelled **"AI-generated (model)"** or **"DEMO — pre-written, not live AI"**.
- **Preliminary level estimate** per topic (Elo-style), stored only in the student's browser. It is an estimate, not proof of mastery.

## What Phase 2A (Knowledge Explorer) adds

- Ask educational or research questions in Darija, Arabic, French, English or Arabizi; answers at 3 levels.
- Each part of an answer is labelled **fact / explanation / assumption / uncertainty**.
- **Source transparency:** the AI cannot write source titles or URLs; it may only cite sources the server retrieved. With no retriever configured (current state), answers say clearly that they are **not source-verified**.
- **Related concepts**, always labelled as AI suggestions.
- **Learning mode:** simplify, examples, or a short self-check quiz (not graded, not recorded).
- **Knowledge cards** saved in the browser, organised in collections, with their verification status.

## What Phase 2B (Evidence Analyzer) adds

- Enter a claim (Darija, Arabic, French, English, Arabizi). SCIORA splits it into sub-claims and classifies each as **factual, opinion, prediction, value judgment or ambiguous**.
- **Verdicts are computed by SCIORA's server, not the AI:** Supported / Contradicted / Mixed / Insufficient Evidence / Not checkable.
- **Evidence = a quote from a retrieved source that the server has checked.** AI knowledge is never evidence; it appears only as a separate "background — not evidence" note.
- For every sub-claim SCIORA explains **what evidence would be needed** to check it.

## Run it

Requirements: Node.js 22+.

```bash
npm install
```

```bash
npm start
```

Open http://127.0.0.1:8787. Without configuration SCIORA runs in **demo mode**: 5 pre-written lessons and 5 pre-written knowledge answers (photosynthesis, Pythagoras, distributivity, the principle of inertia, the water cycle), no AI calls, no sources.

Configuration lives in environment variables; see [`.env.example`](.env.example). **Never commit `.env`.**

| Variable | Meaning |
|---|---|
| `SCIORA_AI_MODE` | `demo` (default) or `live`. Live mode also needs `ANTHROPIC_API_KEY`. A key alone does **not** enable live mode. |
| `SCIORA_MODEL_LEARN` / `_FAST` / `_REASON` | Model routing (defaults: `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-opus-5-5`; REASON is unused in Phase 1). |
| `SCIORA_TOKEN_SECRET` | ≥ 32 random bytes; **required in production** (encrypts exercise answer keys). |
| `SCIORA_GRADE_ESCALATION` | `on` re-grades "uncertain" written answers once with the LEARN model (costs more). |
| `SCIORA_DAILY_LIMIT` | Max AI calls per day in live mode (0 = no limit). |
| `SCIORA_RETRIEVER` | `wikipedia` (default, free MediaWiki API) or `none`. |
| `SCIORA_WIKI_USER_AGENT` | User-Agent with contact info, as Wikimedia asks. Behind an HTTPS proxy, run Node with `NODE_USE_ENV_PROXY=1`. |

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

`npm run test:live` and `npm run eval:grading` make **real, billed** API calls and refuse to run unless `SCIORA_ALLOW_LIVE_TESTS=1`, `SCIORA_AI_MODE=live` and a key are all set — and they are run only with the project owner's approval. Results: [`TEST_REPORT.md`](TEST_REPORT.md).

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
| [`docs/planned/GOOGLE_SIGN_IN.md`](docs/planned/GOOGLE_SIGN_IN.md) | Planned (not implemented) optional sign-in design |
| [`docs/waicy/PROJECT_DOSSIER.md`](docs/waicy/PROJECT_DOSSIER.md) | WAICY dossier: problem, solution, AI, architecture, innovation, ethics, limitations, testing, journey |
| [`docs/waicy/DEMO_SCRIPT.md`](docs/waicy/DEMO_SCRIPT.md) | Demo video script (≤ 3 min) |
| [`docs/waicy/JUDGE_QA.md`](docs/waicy/JUDGE_QA.md) | Judge Q&A preparation |

## Licence

All rights reserved (private competition project).
