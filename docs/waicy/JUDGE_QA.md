# SCIORA — Judge Q&A preparation

_Answers must match the real project. When in doubt, say what is and is not implemented._

**Did you train an AI model?**
No. SCIORA uses pre-trained Claude models through the official API. SCIORA's own adaptive part is an Elo-style estimate that updates from the student's graded answers.

**Has the AI been tested with real API calls?**
Not yet. All AI paths are tested with a fake client that returns scripted responses; live testing requires an API key and approval. Demo mode uses pre-written content and is always labelled DEMO.

**How do you prevent hallucinated sources?**
The AI's output format has no fields for titles or links. It can only cite source IDs that the server actually retrieved; any other ID is removed and the removal is shown to the student. In the Evidence Analyzer, evidence must be an exact quote that the server finds in the retrieved text.

**Who decides if an answer is correct, or if a claim is supported?**
The server. Multiple choice, numbers and algebra are graded by rules. For written answers the AI judges each rubric criterion and must quote the student's answer; the server checks the quote and applies the verdict rule. Evidence verdicts are computed from verified quotes only.

**Why "insufficient evidence" instead of saying true or false?**
Because without retrieved evidence SCIORA cannot know. Showing "insufficient evidence" teaches that missing evidence is not proof either way. "Partially supported" is used when some parts are supported and none contradicted.

**Is Wikipedia reliable enough?**
Not on its own, and SCIORA says so: a notice appears whenever an answer or verdict rests only on Wikipedia, with advice to check a textbook or official source.

**Why is SCIORA English-only, and how do you grade written answers fairly?**
SCIORA is English-only for an international audience: it avoids mixed-language answers and translation errors, and a question in another language gets a clear English-only notice. The rubric prompt asks the AI to judge meaning, not wording; spelling does not lower the grade. Doubtful cases become "uncertain" (never "incorrect") and do not affect the level estimate. 38 English test cases cover formal, informal, paraphrased and misspelled answers, partial and wrong answers, and maths.

**What about privacy?**
No accounts, names or emails. Progress and knowledge cards are stored only in the browser. Logs exclude answers and questions.

**What would you improve next?**
Broader live AI testing and evaluation, my own review of all demo content, more reliable sources beyond Wikipedia, and optional accounts for synced progress with protections for minors.

**Who built it?**
I directed the project, made the decisions and tested it. The code was written with the help of Claude (Anthropic) via Claude Code, as disclosed in `AI_USAGE_DISCLOSURE.md`.
