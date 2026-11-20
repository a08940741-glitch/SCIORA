# WAICY 2026 — Submission Checklist (AI Showcase)

_Items marked **(reported)** come from the project owner's reading of the official Guidebook and have **not** been independently verified here. Re-check everything on the official WAICY site and submission portal before submitting._

## 1. Key facts
| Item | Value | Status |
|---|---|---|
| Deadline | 2026-11-29, 5:00 PM ET **(reported)** = 22:00 UTC = **23:00 Morocco time** (Morocco UTC+1; ET is UTC−5 in November) | Verify on portal |
| Category | AI Showcase, Individual, Middle School (Grade 7) | Verify |
| Folder name | `Main_<Category>_<ProjectName>` **(reported)** | Verify exact category string |
| Description & AI-usage text | ≤ 200 words where Guidebook and form differ **(reported)** | Verify on portal |
| Videos | Each ≤ 3 minutes; language/subtitle rules **(reported)** | Verify |

## 2. Deliverables
- [ ] `Presentation.pdf`
- [ ] `Description.pdf` (≤ 200 words unless portal says otherwise)
- [ ] `DemoVideo.mp4` (≤ 3 min, subtitles as required)
- [ ] `PresentationVideo.mp4` (≤ 3 min, subtitles as required)
- [ ] Folder named per convention

## 3. Content checks
- [ ] Every claim in slides/videos matches `FEATURE_STATUS.md` (no planned feature shown as working).
- [ ] Demo video states clearly whether it shows **demo mode** or **live AI**.
- [ ] AI usage disclosure matches `AI_USAGE_DISCLOSURE.md` (code written with Claude under the student's direction).
- [ ] No invented statistics in the problem statement; any number has a verified source.
- [ ] Five Big Ideas described honestly (Perception not implemented; SCIORA does not train models).
- [ ] Knowledge Explorer presented honestly: no real source retrieval yet; demo answers have no sources.
- [ ] Evidence Analyzer presented honestly: without retrieval, factual claims get “insufficient evidence”; AI background is not evidence.
- [ ] Ethics section reflects `AI_ETHICS.md`.
- [ ] The student can explain: provider abstraction, encrypted exercise tokens, replay protection, rule-based grading, rubric aggregation and “uncertain”, the Elo estimate and its limits.

## 4. Technical checks before recording
- [ ] Owner decision on live mode (API key, approval for live smoke test and grading evaluation).
- [ ] Owner review of demo lessons (Darija + science) and grading labels.
- [ ] `npm test`, `npm run test:e2e`, `npm run typecheck` pass on the recorded version.
- [ ] Secret scan passes; no `.env` committed.
- [ ] Deployment (if any) uses a production `SCIORA_TOKEN_SECRET`.

## 5. Schedule (as of 2026-11-20)
| Date | Plan |
|---|---|
| Nov 20 | Phase 1 implemented and tested (demo mode) ✔ |
| Nov 20 | Phase 2A Knowledge Explorer implemented and tested (demo mode) ✔ |
| Nov 20 | Phase 2B Evidence Analyzer implemented and tested (demo mode) ✔ |
| Nov 21–24 | Owner review; live mode and retriever decisions; polish |
| Nov 25 | UI polish, deploy |
| Nov 26 | Full testing, AI quality evaluation (if approved) |
| Nov 27 | Description, AI usage text, slides |
| Nov 28 | Record videos (owner) |
| Nov 29 | Buffer; submit well before 23:00 Morocco time |
