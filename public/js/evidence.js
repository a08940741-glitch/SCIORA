import { api } from "./api.js";
import { T } from "./i18n.js";
import { el, clear, paragraphs } from "./render.js";
import { errorMessage } from "./errors.js";
import { noticesBox } from "./notices.js";
import { isSafeHttpsUrl } from "./cards-store.js";
import { sourceMeta } from "./explorer.js";

/**
 * Evidence Analyzer UI. Verdicts come from the SERVER (evidence quoted from retrieved
 * sources only). AI background notes are shown separately and labelled "not evidence".
 */
const E = T.e;
const $ = (id) => document.getElementById(id);

function provenanceBadge(meta) {
  if (!meta || meta.simulated) return el("span", { class: "badge badge-demo", "data-provenance": "demo", text: E.badgeDemo });
  return el("span", { class: "badge badge-ai", "data-provenance": "ai", text: E.badgeAi(meta.model || "Claude") });
}

function verdictChip(v) {
  return el("span", { class: `verdict-chip verdict-chip-${v}`, "data-verdict": v, text: E.verdicts[v] ?? v });
}

function basisBanner(r) {
  const b = r.basis;
  const box = el("div", { id: "e-basis", class: `verification verification-${b.kind === "retrieved_sources" ? "source_backed" : r.meta.simulated ? "demo" : "not_source_verified"}`, "data-basis": b.kind, role: "note" });
  box.append(el("p", { class: "verification-title" }, el("strong", { text: b.kind === "retrieved_sources" ? E.basisSources(b.evidenceItems) : r.meta.simulated ? E.basisDemo : E.basisNone })));
  box.append(el("p", { text: b.kind === "retrieved_sources" ? E.basisSourcesDetail : E.basisNoneDetail }));
  if (b.kind !== "retrieved_sources" && b.retrievalNote && T.k.retrievalNote[b.retrievalNote]) box.append(el("p", { class: "muted", text: T.k.retrievalNote[b.retrievalNote] }));
  if (b.removedEvidence > 0) box.append(el("p", { class: "muted", text: E.removed(b.removedEvidence) }));
  return box;
}

function subClaimCard(s, r) {
  const sourcesById = new Map(r.sources.map((x) => [x.id, x]));
  const evidence = s.evidence.length
    ? el(
        "ul",
        { class: "evidence-list" },
        ...s.evidence.map((ev) => {
          const src = sourcesById.get(ev.sourceId);
          return el(
            "li",
            { class: `evidence evidence-${ev.stance}`, "data-stance": ev.stance, dir: "auto" },
            el("span", { class: "kind-chip", text: E.stances[ev.stance] }),
            el("q", { text: ev.quote }),
            el("span", { class: "muted", dir: "ltr", text: ` [${ev.sourceId}] ` }),
            src && isSafeHttpsUrl(src.url) ? el("a", { href: src.url, target: "_blank", rel: "noopener noreferrer nofollow", text: src.title }) : null,
          );
        }),
      )
    : el("p", { class: "empty-state e-no-evidence", text: s.verdict === "not_checkable" ? E.notCheckableHelp[s.type] ?? E.notCheckableHelp.opinion : E.noEvidence });

  return el(
    "section",
    { class: "card", "data-subclaim": s.id },
    el("header", { class: "card-head" }, el("h3", { text: s.text }), el("div", { class: "badges" }, el("span", { class: "badge badge-type", "data-type": s.type, text: E.types[s.type] }), verdictChip(s.verdict))),
    el("p", { class: "label", text: E.evidenceTitle }),
    evidence,
    el("p", { class: "label", text: E.missingTitle }),
    el("p", { text: s.missingEvidence }),
    s.backgroundNote
      ? el("div", { class: "background-note", "data-not-evidence": "true" }, el("p", { class: "label", text: r.meta.simulated ? E.backgroundDemo : E.backgroundAi }), ...paragraphs(s.backgroundNote))
      : null,
  );
}

export function createEvidencePanel() {
  function renderClaims(claims) {
    const box = $("e-claims");
    clear(box);
    if (!Array.isArray(claims) || !claims.length) return;
    box.append(el("p", { class: "muted", text: E.demoClaimsTitle }));
    box.append(
      el(
        "div",
        { class: "chips" },
        ...claims.map((c) =>
          el("button", {
            type: "button",
            class: "chip",
            text: c.claim,
            onclick: () => {
              $("e-claim").value = c.claim;
              $("e-claim").focus();
            },
          }),
        ),
      ),
    );
  }

  function render(r) {
    const out = $("e-result");
    clear(out);
    out.append(basisBanner(r));
    // evidence_removed is already shown with its count in the basis banner.
    const nb = noticesBox(r.notices, { skip: ["evidence_removed", "demo_content"] });
    if (nb) out.append(nb);
    out.append(
      el(
        "section",
        { class: "card", id: "e-overall" },
        el("header", { class: "card-head" }, el("h3", { text: E.overallTitle }), provenanceBadge(r.meta)),
        el("p", { class: "muted", text: r.understood.claimRestated }),
        r.understood.clarification ? el("p", { class: "alert alert-info", text: r.understood.clarification }) : null,
        el("p", { class: "overall-line" }, verdictChip(r.overall.verdict)),
        el("p", { text: E.overallHelp[r.overall.verdict] }),
      ),
    );
    for (const s of r.subClaims) out.append(subClaimCard(s, r));
    if (r.basis.kind !== "retrieved_sources" && r.sources.length > 0) {
      out.append(
        el(
          "section",
          { class: "card", id: "e-related" },
          el("h3", { text: E.relatedTitle }),
          el("p", { class: "muted", text: E.relatedHelp }),
          el(
            "ul",
            { class: "sources" },
            ...r.sources.map((s) =>
              el("li", { "data-source-id": s.id }, isSafeHttpsUrl(s.url) ? el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer nofollow", text: s.title }) : el("span", { text: s.title }), el("p", { class: "muted", text: sourceMeta(s) })),
            ),
          ),
          r.sources.some((s) => s.retriever === "wikipedia") ? el("p", { class: "source-caution", text: T.k.wikipediaCaution }) : null,
        ),
      );
    }
    if (r.caveats.length) out.append(el("section", { class: "card" }, el("h3", { text: T.caveats }), el("ul", { class: "caveats", dir: "auto" }, ...r.caveats.map((c) => el("li", { text: c })))));
  }

  async function onAnalyze(ev) {
    ev.preventDefault();
    const claim = $("e-claim").value.trim();
    const out = $("e-result");
    if (claim.length < 5) {
      clear(out);
      out.append(el("div", { class: "alert alert-error", role: "alert", text: E.tooShort }));
      return;
    }
    const btn = $("e-analyze");
    btn.disabled = true;
    btn.textContent = E.loading;
    clear(out);
    out.append(el("p", { class: "muted", role: "status", text: E.loading }));
    const r = await api.analyze(claim, $("e-language").value);
    btn.disabled = false;
    btn.textContent = E.analyze;
    if (!r.ok) {
      clear(out);
      out.append(el("div", { class: "alert alert-error", role: "alert", text: errorMessage(r) }));
      return;
    }
    render(r.data);
  }

  function initStatic() {
    $("e-title").textContent = E.title;
    $("e-intro").textContent = E.intro;
    $("e-claim-label").textContent = E.claimLabel;
    $("e-claim").placeholder = E.claimPlaceholder;
    $("e-language-label").textContent = E.languageLabel;
    for (const [v, label] of Object.entries(T.k.languages)) $("e-language").append(el("option", { value: v, text: label }));
    $("e-analyze").textContent = E.analyze;
    $("e-empty").textContent = E.empty;
    $("e-form").addEventListener("submit", onAnalyze);
  }

  return { initStatic, renderClaims };
}
