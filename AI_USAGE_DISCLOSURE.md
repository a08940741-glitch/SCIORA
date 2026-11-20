# SCIORA — AI Usage Disclosure

_Honest account of how AI tools were used to **build** SCIORA and how AI is used **inside** SCIORA. Keep this up to date._

## 1. People and tools that built SCIORA

| Contributor | Role |
|---|---|
| **Project owner (student, Grade 7, Morocco)** | Project idea and vision, decisions and approvals (architecture, security requirements, scope, models), requirements for Darija/Arabic grading quality, testing the application, reviewing Darija content (pending), presenting to judges. |
| **Claude (Anthropic), via Claude Code** | Wrote the source code, tests and documentation under the owner's direction; proposed the architecture and security design, which the owner reviewed and revised (e.g. requiring AES-256-GCM encryption instead of HMAC-only tokens, fail-closed capacity, atomic grading reservation, Darija grading tests). Drafted the 5 demo lessons, the 37 grading fixtures the 5 Knowledge Explorer demo answers and the 5 Evidence Analyzer demo analyses (all marked unreviewed). Implemented Phase 2B autonomously within the owner's standing rules (no live calls, no push, no fabricated evidence). Implemented Phase 2A after the owner approved the plan and decisions D1–D3 (no real retrieval yet; behaviour-preserving refactor; narrow test updates). |
| **ChatGPT (OpenAI)** | According to the project plan: independent research, architecture and rubric review, critical review. (Recorded as reported by the project owner.) |

**Important:** most of the code was written by an AI assistant (Claude). The student did not hand-write the code. The student directed the project, made the decisions, and must be able to explain every major component — this disclosure must be reflected accurately in all competition materials.

## 2. AI used inside SCIORA (runtime)

| Function | Mode | AI used | Notes |
|---|---|---|---|
| Lesson generation (explanations, example, exercises) | Live | `claude-sonnet-5-5` (configurable) | Structured output validated by SCIORA. |
| Grading written answers (rubric judgement) | Live | `claude-haiku-5-5` (configurable); optional escalation to the LEARN model | SCIORA's server decides the final verdict. |
| Grading MCQ, numbers, expressions | Both | **No AI** — rules | Deterministic. |
| Lessons and grading in demo mode | Demo | **No AI at runtime** | Pre-written content, clearly labelled DEMO. |
| Level estimate | Both | **No AI model** — Elo-style formula | Runs in the browser. |
| Knowledge Explorer answers | Live | `claude-sonnet-5-5` (configurable) | Structured output; may only cite server-retrieved sources (none exist yet). |
| Knowledge Explorer simplify / examples / quiz | Live | `claude-haiku-5-5` (configurable) | Self-check quiz, not graded. |
| Knowledge Explorer in demo mode | Demo | **No AI at runtime** | Pre-written, no sources, labelled DEMO. |
| Source verification status | Both | **No AI** — server rules | AI cannot decide it. |
| Evidence Analyzer: claim splitting, classification, quoting | Live | `claude-opus-5-5` (REASON tier, configurable) | Quotes are checked by the server; AI cannot set verdicts. |
| Evidence verdicts | Both | **No AI** — server rules | Computed only from verified quotes. |
| Evidence Analyzer in demo mode | Demo | **No AI at runtime** | Pre-written, no evidence, labelled DEMO. |

- SCIORA **does not train or fine-tune** any AI model. The language models are pre-trained by Anthropic.
- As of 2026-11-20, **live mode has not been run against the real API**; all tests use demo mode or a fake client / fake retriever. No real source retrieval exists.

## 3. Short AI usage statement (draft for the submission form — ≤ 200 words, to be finalised by the owner)

> SCIORA uses Anthropic's Claude models through the official API. In live mode, Claude Sonnet generates explanations in Moroccan Darija and Arabic, worked examples and exercises, returned in a strict structured format that SCIORA validates. Claude Haiku judges written answers criterion by criterion against a rubric and must quote evidence from the student's answer; SCIORA's server, not the AI, decides the final verdict and marks doubtful cases as “uncertain”. Multiple-choice, numeric and algebraic answers are graded by rules without AI. SCIORA does not train any model; its adaptive part is an Elo-style estimate that updates from the student's graded answers. A demo mode with pre-written, clearly labelled content works without AI. The code was written with the help of Claude (Anthropic) via Claude Code under the student's direction; the student designed the project, made the decisions and tested the application.

_(Word count must be re-checked against the official limit before submission.)_
