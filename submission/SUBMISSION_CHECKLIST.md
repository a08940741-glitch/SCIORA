# SCIORA — WAICY 2026 Submission Checklist

_Personal details are placeholders: fill them in yourself. Rules marked **(reported)** come from the project owner's reading of the WAICY Guidebook and were **not** verified here; confirm every one on the official WAICY website and submission portal._

## 1. Deadline and rules
- [ ] Deadline confirmed on the portal: **Nov 29, 2026, 5:00 PM ET (reported)** = **23:00 Morocco time**. Plan to submit by **Nov 28**.
- [ ] Category confirmed: **AI Showcase**, Individual (reported; confirm the exact category name on the portal).
- [ ] Word limits confirmed for the description and the AI-usage text (≤ 200 words reported).
- [ ] Video rules confirmed: length (≤ 3 minutes reported), language and subtitle requirements, accepted formats.
- [ ] Folder naming rule confirmed: `Main_<Category>_<ProjectName>` (reported).

## 2. Participant details (competition form)
| Field | Value |
|---|---|
| Full name | `[YOUR FULL NAME]` |
| Grade / school level | `[CONFIRM — project records say Grade 7]` |
| School | `[YOUR SCHOOL NAME]` |
| City / country | `[YOUR CITY]`, Morocco `[confirm]` |
| Email | `[YOUR EMAIL]` |
| Parent / guardian (name, email, consent if required) | `[PARENT OR GUARDIAN DETAILS]` |
| Teacher / mentor (if any) | `[NAME OR "none"]` |
| Team members | Individual project `[confirm]` |
| Project name | SCIORA — Global Knowledge & Learning Intelligence |

- [ ] All form fields completed and double-checked (spelling of names and email).
- [ ] Parent/guardian consent completed if the portal requires it.

## 3. Project texts
- [ ] **Project description**: use the "Competition description (under 200 words)" in [`PROJECT_DESCRIPTION.md`](PROJECT_DESCRIPTION.md); re-count words in the portal.
- [ ] **AI usage disclosure**: based on [`../AI_USAGE_DISCLOSURE.md`](../AI_USAGE_DISCLOSURE.md) (code written with an AI coding assistant under the student's direction; demo content drafted with AI help and not yet reviewed). Keep it within the word limit.
- [ ] **Technical explanation** (if a field or document is requested): [`AI_TECHNICAL_EXPLANATION.md`](AI_TECHNICAL_EXPLANATION.md).
- [ ] Every claim matches [`../FEATURE_STATUS.md`](../FEATURE_STATUS.md): demo mode works; live AI with **Groq passed one first controlled test in English** (2026-11-21); Claude is built but **never run against the real API**; sign-in is planned only.

## 4. Deliverables (reported — confirm names and formats)
- [ ] `Description.pdf`: export of the competition description (and any other required text).
- [ ] `Presentation.pdf`: slides (problem, solution, the three tools, how SCIORA keeps AI honest, limitations, next steps).
- [ ] `DemoVideo.mp4`: recorded from [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md), ≤ 3 min, DEMO labels visible.
- [ ] `PresentationVideo.mp4`: you presenting the project, ≤ 3 min.
- [ ] Subtitles added if required.

## 5. Screenshots (take in demo mode, English interface)
- [ ] Home screen with the three tools and the Demo-mode banner.
- [ ] Learning Assistant: lesson with the DEMO badge.
- [ ] Exercises with feedback and the session summary.
- [ ] Knowledge Explorer: labelled segments + verification box.
- [ ] Evidence Analyzer: two sub-claims, "Insufficient evidence", "What evidence would be needed?".
- [ ] Progress screen.
- [ ] The English-only notice shown for a non-English question.

## 6. Links
| Link | Value | Notes |
|---|---|---|
| Source code repository | `https://github.com/a08940741-glitch/sciora` | **Private.** If judges need access, decide how (invite, or make public) — your decision. Push only after you approve. |
| Live website | `[NONE YET — or URL if you deploy]` | Not deployed. Only add if you deploy it yourself. |
| Google Drive folder | `[DRIVE FOLDER LINK]` | Name it per the folder rule. |
| Demo video | `[VIDEO LINK]` | |
| Presentation video | `[VIDEO LINK]` | |

## 7. Google Drive folder
- [ ] Folder created and named `Main_<Category>_SCIORA` (confirm exact pattern).
- [ ] Contains `Description.pdf`, `Presentation.pdf`, `DemoVideo.mp4`, `PresentationVideo.mp4` (and anything else the portal requires).
- [ ] Sharing set to **"Anyone with the link can view"** (or as the rules require).
- [ ] Opened every file from a signed-out/private window to confirm judges can see it.

## 8. Technical checks on the version you record
- [ ] `npm test`, `npm run test:e2e`, `npm run typecheck` all pass (on 2026-11-22: 402 unit/API + 37 browser tests, all passing).
- [ ] `npm run secret-scan` passes; no `.env` or API key anywhere in the repository or the Drive folder.
- [ ] App starts in **demo mode** with no configuration (`npm start`).
- [ ] You reviewed the demo lessons, answers and claims (science and English) — or the video does not claim they are teacher-reviewed.
- [ ] Code changes on `feature/groq-free-provider` committed (and pushed) **only after your approval**.

## 9. Final submission verification
- [ ] Portal form submitted; confirmation screen or email saved (screenshot).
- [ ] All links open correctly from a private window.
- [ ] Video lengths checked (≤ limit).
- [ ] Submitted before the deadline, with time to spare.

## 10. Things you must be able to explain to judges
- Why multiple-choice/number/algebra answers are graded by rules, not AI.
- How written answers are graded (rubric criteria, quotes checked by the server, "uncertain").
- Why the AI cannot invent sources or evidence (the server checks every source ID and quote).
- What demo mode is, and why live AI was not tested yet (cost, approval, safety).
- What the level estimate is (Elo-style, preliminary, stored only in the browser).
- The limits: language checks are heuristics, Wikipedia (English) is the only source, demo content not yet reviewed.
- Why SCIORA is English-only (international audience; avoids mixed-language and translation errors).
