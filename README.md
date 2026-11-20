# SCIORA — Global Knowledge & Learning Intelligence

**WAICY 2026 · AI Showcase · Individual · Grade 7 · Morocco**

SCIORA is an AI-assisted learning platform. Its first implementation, **Darija AI Study**, helps Moroccan students understand school topics in Moroccan Darija and Arabic, practise with exercises, and get honest, explained feedback.

> **Current status: Phase 1 (learning loop) implemented and tested in demo mode.**
> Live AI mode is built but has **not yet been run against the real API** (no live calls without the project owner's approval).
> Knowledge Explorer, Evidence Analyzer, the Progress screen and optional Google Sign-In are **planned (Phase 2), not implemented.**
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

## Run it

Requirements: Node.js 22+.

```bash
npm install
```

```bash
npm start
```

Open http://127.0.0.1:8787. Without configuration SCIORA runs in **demo mode**: 5 pre-written lessons (photosynthesis, Pythagoras, distributivity, the principle of inertia, the water cycle), no AI calls.

Configuration lives in environment variables; see [`.env.example`](.env.example). **Never commit `.env`.**

| Variable | Meaning |
|---|---|
| `SCIORA_AI_MODE` | `demo` (default) or `live`. Live mode also needs `ANTHROPIC_API_KEY`. A key alone does **not** enable live mode. |
| `SCIORA_MODEL_LEARN` / `_FAST` / `_REASON` | Model routing (defaults: `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-opus-5-5`; REASON is unused in Phase 1). |
| `SCIORA_TOKEN_SECRET` | ≥ 32 random bytes; **required in production** (encrypts exercise answer keys). |
| `SCIORA_GRADE_ESCALATION` | `on` re-grades "uncertain" written answers once with the LEARN model (costs more). |
| `SCIORA_DAILY_LIMIT` | Max AI calls per day in live mode (0 = no limit). |

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

## Licence

All rights reserved (private competition project).
