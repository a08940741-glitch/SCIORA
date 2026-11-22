# SCIORA — Project Description

_WAICY 2026 · AI Showcase. Everything below matches the code on branch `feature/groq-free-provider` (2026-11-21). Live AI with Groq has passed **one** first controlled test (English); Anthropic has never been run live. See "Limitations"._

## Project name
**SCIORA — Global Knowledge & Learning Intelligence**

## Problem
Students increasingly use AI chatbots for homework, but a typical chatbot:
- answers confidently even when it is wrong, and rarely says "I am not sure";
- mixes facts, guesses and opinions in one fluent paragraph;
- can invent sources that do not exist;
- explains, but does not check whether the student actually understood.

Students also meet AI answers that mix languages, translate inconsistently or switch language mid-answer. SCIORA avoids this by being English-only. _(No statistics are claimed here; the project has not measured these problems.)_

## Language policy
SCIORA is an English-only AI learning and knowledge platform designed for an international audience. The interface, lessons, exercises, feedback, knowledge answers and evidence analyses are all in English. A question or answer that is clearly in another language receives the notice: “SCIORA currently supports English only. Please submit your question in English to continue.”

## Solution
SCIORA is a learning platform built around **honest AI**: it explains, tests understanding, and always shows what is verified and what is not. It has three connected tools:

1. **Learning Assistant** — explains a school topic (simple explanation, formal explanation, steps, worked example), then gives three exercises and grades them with explained feedback.
2. **Knowledge Explorer** — answers educational questions with every part labelled *fact*, *explanation*, *assumption* or *uncertainty*, and states whether the answer is backed by retrieved sources.
3. **Evidence Analyzer** — splits a claim into parts, separates checkable facts from opinions and predictions, and judges facts only on quotes found in retrieved sources.

A **Progress** screen shows a preliminary per-topic level estimate, and **Knowledge cards** let students save answers.

## Target users
Middle- and high-school students worldwide (an international, English-speaking audience), and teachers or parents who want AI help that is transparent about its limits.

## AI capabilities (as implemented)
| Capability | How it works |
|---|---|
| Lesson generation | A language model writes the explanation, steps, example and 3 exercises as **structured JSON** that must match a strict schema. |
| Written-answer grading | The model judges each rubric criterion and must quote the student's own words; the **server** checks the quotes and computes the verdict. |
| Knowledge answers | The model labels each segment (fact / explanation / assumption / uncertainty) and may cite only sources the server retrieved. |
| Evidence analysis | The model splits and classifies sub-claims and proposes quotes; the **server** keeps only quotes that really appear in retrieved sources and computes the verdicts. |
| Deterministic grading | Multiple-choice, numeric and algebraic answers are graded by rules, not AI (e.g. `1/2 = 0.5`, `2(x+1) = 2x+2`). |
| Adaptive estimate | An Elo-style, per-topic **preliminary** level estimate updates from graded answers (uncertain results are ignored). |
| Retrieval | Free Wikipedia (MediaWiki) API, fixed hosts only. |
| Providers | Demo (pre-written, default), Anthropic Claude (paid) or Groq (free tier) — selected on the server. |

## Educational impact (intended — not measured)
- Students learn to separate **facts, assumptions and uncertainty** instead of trusting fluent text.
- Students practise **evidence-based thinking**: a claim is only "supported" if a real source says so.
- Feedback explains mistakes and suggests the next step, and SCIORA admits when it is unsure.
- Clear, consistent English throughout: SCIORA is an English-only AI learning and knowledge platform designed for an international audience.

No user study has been run, so these are goals, not results.

## Limitations (honest)
- **Live AI is only partly verified.** Groq (free tier, `openai/gpt-oss-120b`) passed one first controlled test on 2026-11-21: all 6 AI calls completed in English and passed SCIORA's automatic checks, but the free-tier rate limit was hit after 4 back-to-back calls. Live content is not yet teacher-reviewed, and Anthropic has never been run against a real API. The demo video shows **demo mode**: pre-written content for 5 topics and 5 claims.
- Demo content was drafted with AI assistance and is **not yet reviewed** by the project owner or a teacher.
- Groq's free tier requires an account holder aged 18+ and has changing rate limits.
- Wikipedia is the only source; it is never presented as sufficient proof on its own.
- The level estimate is preliminary and stored only in the browser; it is not proof of mastery.
- Sign-in is planned, not implemented. Image/voice input (perception) is not implemented. SCIORA does not train models.

## Competition description (under 200 words)

> SCIORA is an AI learning platform built on one principle: honest AI. Students often trust chatbots that sound certain, mix facts with guesses and sometimes invent sources. SCIORA connects three tools. The Learning Assistant explains school topics, then tests understanding with exercises: multiple-choice, numeric and algebra answers are graded by exact rules, while written answers are judged criterion by criterion, with the server checking that every quote really comes from the student's answer. When SCIORA is unsure, it says "uncertain" instead of guessing. The Knowledge Explorer labels every part of an answer as fact, explanation, assumption or uncertainty, and the AI may cite only sources the server actually retrieved from Wikipedia. The Evidence Analyzer splits claims into parts, separates facts from opinions and predictions, and judges facts only on verified quotes. SCIORA is English-only for an international audience, and every result is labelled as demo content or AI-generated. The demo shown runs in a clearly labelled demo mode; live AI with the free Groq tier has passed a first controlled test in English.

_Word count: 173 (counted automatically; re-count with the portal's own counter)._
