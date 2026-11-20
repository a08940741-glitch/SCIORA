# SCIORA — Development Log

Newest entries at the bottom. Do not delete history; add corrections as new entries.

## 2026-11-20 — Phase 0: workspace audit
- Workspace empty; no SCIORA repository existed. Owner's other repos (DAWRA, a COD dashboard) inspected read-only for reusable patterns (Arabic RTL i18n, Fastify + zod, `node:test`).
- Network: npm reachable; `api.anthropic.com` reachable (needs key); Wikipedia blocked in the dev container.
- Private repo `SCIORA` created by the owner and attached; no pushes.

## 2026-11-20 — Phase 1 planning (3 revisions, owner-approved)
- **Rev 1:** Fastify/TypeScript/zod, provider abstraction, HMAC-signed exercise tokens, Opus default.
- **Rev 2 (owner feedback):** HMAC does not hide contents → **AES-256-GCM** tokens with expiry + replay store; Elo score framed as a *preliminary estimate*; strict AI/demo transparency; **Sonnet 5.5 / Haiku 5.5 / Opus 5.5** routing; no live calls without approval; Explorer/Evidence documented as Phase 2.
- **Rev 3 (owner feedback):** replay store must **never evict** unexpired records (fail closed); **atomic reservation** for concurrent grading; Darija/MSA/paraphrase/maths/partial/incorrect grading tests; never reject correct answers for wording; rubric-based evaluation with explained uncertainty.
- Optional Google Sign-In added to the roadmap as Phase 2 (docs only).

## 2026-11-20 — Phase 1 implementation (Steps 0–12)
Built in order with a test gate per step; local commits only.

Errors found and fixed during gates:
1. **Expression grading returned “unknown” for everything** — mathjs `OperatorNode.fn` holds the function *name* (`add`, `multiply`…), not the symbol. Whitelist corrected.
2. **`x²` not recognised** — Unicode NFKC turned `²` into `2` before the `^2` conversion. Superscripts are now converted before NFKC.
3. **Demo keyword `²` violated the ≥2-character rule** — removed (`^2` covers it after normalization).
4. **Demo topic not matched for «ننشر»** — Darija verb missing from keywords; added.
5. **Secret scan blocked a commit** — a test used a fake value shaped like an Anthropic key. The value was changed; the scan was not weakened.
6. **English text inside the Arabic UI** (seen on screenshots) — demo caveats, rubric criteria, uncertainty reasons and error messages localised to Darija.
7. One rubric test was written with a wrong expectation; corrected to match the approved rule before running.

Deliberate simplifications (documented):
- Unreadable numeric/expression answers return **422** with a format hint and do not consume the attempt, instead of being sent to the AI.
- At the 90% capacity mark `/api/learn` returns 503 before any AI call; there is no “explanation-only” fallback.

## Next actions
- Owner: review demo lessons and grading labels (Darija + science); decide on API key and live tests.
- Then: Phase 2 (Knowledge Explorer, Evidence Analyzer) per priority, deployment, submission package.
