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

## 2026-11-20 — Phase 2A: Knowledge Explorer
- Step 1 inspection: Wikipedia API unreachable from the dev container; no real source path without paid/live calls.
- Owner decisions: **D1** interface + fake retriever only (no fabricated sources; live answers labelled not source-verified); **D2** move `callStructured()` to a shared helper only if behaviour-preserving; **D3** narrow the outdated browser assertion to Evidence Analyzer only.
- Steps 3–13 implemented with a test gate and local commit each (`b367d56` … `d8ee223`).
- D2 verification: moved code diffed against the original — identical apart from `this.client` → parameter; Phase 1 provider tests 20/20 before and after.
- `DailyBudget`/`sendError` and the browser `errorMessage` moved verbatim to shared modules.

Issues found and fixed:
1. Circular runtime import between `sources.ts` and `service.ts` (`MAX_SOURCES`) — constant moved to `sources.ts`.
2. TypeScript inferred strict types from the plain-JS cards store in tests — test imports typed loosely; runtime validation unchanged.
3. Phase 1 E2E chip count became 10 (new panel has its own chips) — locator scoped to `#demo-topics`; intent unchanged.
4. Phase 1 health test asserted Explorer was "planned" — updated narrowly (Explorer not planned, Evidence still planned).
5. Footer still said "Phase 1" — updated.

## Next actions
- Owner: review demo lessons and grading labels (Darija + science); decide on API key and live tests.
- Owner: review Knowledge Explorer demo content; decide on a real source retriever (Wikipedia network approval or paid web search).
- Then: Phase 2B (Evidence Analyzer) after approval, deployment, submission package.
