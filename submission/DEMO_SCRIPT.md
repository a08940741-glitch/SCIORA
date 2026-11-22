# SCIORA — Demo Video Script (≈ 2:45)

_Records **demo mode** (the default). Every step below uses content that exists in the current build. Do not describe anything as "live AI" in this video: the screen shows the **DEMO** label, and the narration says so._

## Before recording
1. `npm start`, open http://127.0.0.1:8787 in a fresh browser window (or clear site data with the **Clear my data** button so Progress starts empty).
2. Interface language: **English**. Window wide enough to show the sidebar.
3. Optional: be online so Wikipedia "related reading" can appear in the Knowledge Explorer (the demo works offline too, without it).
4. Practise once. Exact inputs are given below; nothing needs to be typed fast.

## Script

| Time | Screen action | Narration (read exactly) |
|---|---|---|
| **0:00–0:15** | Home screen: sidebar, the three tool cards. Point to the **Demo mode** banner at the top. | "This is SCIORA, a learning platform built on one idea: honest AI. It explains, it tests understanding, and it always shows what is verified and what is not. What you see today is demo mode: pre-written content, clearly labelled, so the whole flow can be shown safely." |
| **0:15–0:45** | **Learning Assistant** tab. Click the chip **Mathematics · The Pythagorean theorem** → **Explain**. Scroll slowly: badge **DEMO**, *Simple explanation*, *Formal explanation*, *Steps*, *Worked example*. | "In the Learning Assistant, a student asks about a school topic. SCIORA gives a simple explanation, a formal one, the steps and a worked example. Every card is labelled — here, DEMO, pre-written. Everything in SCIORA is in clear English." |
| **0:45–1:20** | Exercise 1 (multiple choice): pick **"The shortest side of the triangle"** (wrong on purpose) → **Check answer**. Exercise 2 (numeric): type **13** → **Check answer**. Exercise 3 (written): type **In a right triangle, the square of the hypotenuse equals the sum of the squares of the other two sides.** → **Check answer**. The **session summary** appears. | "Now the exercises. Multiple-choice and number answers are graded by exact rules, not by AI — this one is wrong, and SCIORA explains why. Written answers are judged criterion by criterion; in real AI mode the server checks that every quote really comes from the student's answer, and if it is not sure, it says 'uncertain' instead of guessing. After the last exercise, the session summary shows what to practise next." |
| **1:20–1:50** | **Knowledge Explorer** tab. Click the chip **Photosynthesis** → **Explore** (this demo answer contains all four labels). Point to the labels **Fact / Explanation / Assumption / Uncertain** and to the verification box. Click **Simplify**. _(If online: point to **Related reading** from Wikipedia.)_ | "The Knowledge Explorer answers questions, but it labels every part: fact, explanation, assumption or uncertainty. The box at the top says honestly whether the answer is backed by sources — this demo answer is not. The AI is only allowed to cite sources that SCIORA actually retrieved, and it can turn an answer into a simpler explanation, examples or a short quiz." |
| **1:50–2:25** | **Evidence Analyzer** tab. Click the claim chip **The Pythagorean theorem works for every triangle, and the hypotenuse is the longest side of a right triangle.** → **Analyze claim**. Show the two sub-claims, their type, **Insufficient evidence**, *What evidence would be needed?*, and the note labelled **Pre-written demo background · not evidence**. | "The Evidence Analyzer checks claims. SCIORA splits this sentence into two separate claims. A verdict like 'supported' requires a real quote from a retrieved source, checked by the server — so without sources, the honest answer is 'insufficient evidence', and SCIORA explains what evidence would be needed. General AI knowledge is shown separately and labelled: not evidence." |
| **2:25–2:35** | **Progress** tab: the topic appears with a preliminary estimate. | "Progress is built only from the student's own graded answers, stored in their browser. It is a preliminary estimate, not a grade." |
| **2:35–2:45** | In the Learning Assistant, type **¿Qué es la fotosíntesis?** → **Explain**: SCIORA shows the English-only notice. Return to Home. | "SCIORA is English-only, designed for an international audience — a question in another language gets a clear notice instead of a mixed-language answer. SCIORA: learn, explore and verify knowledge — with AI that tells you when it is not sure." |

## Honesty rules for this video
- Say "demo mode" at least once (done at 0:00–0:15) and keep the **DEMO** labels visible.
- Do **not** say the AI "checked" or "graded" anything live: in demo mode written answers are matched against prepared keywords. The narration at 0:45 describes what the server does **in real AI mode**.
- Do **not** claim sources were used unless "Related reading" is visible, and even then say it is related reading, not proof.
- If live AI is mentioned: Groq passed **one first controlled test in English**; Claude has **never** been run against the real API. Say exactly that; do not imply live AI is what the video shows.

## If something goes wrong while recording
- "Not available in demo mode" message: you typed a topic that is not among the five demo topics — click a chip instead.
- No "Related reading": you are offline or Wikipedia was slow; continue, it is optional.
- Progress already shows topics: click **Clear my data** and restart from the Learning Assistant.
