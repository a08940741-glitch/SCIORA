import { api } from "./api.js";
import { T } from "./i18n.js";
import { el, clear, paragraphs } from "./render.js";
import { errorMessage } from "./errors.js";
import { noticesBox } from "./notices.js";
import { cardFromAnswer, isSafeHttpsUrl } from "./cards-store.js";

/**
 * Knowledge Explorer UI. All text via textContent (render.js). External links only for
 * https URLs that came from server-retrieved sources (none exist in Phase 2A, decision D1).
 */
const K = T.k;
const $ = (id) => document.getElementById(id);

function provenanceBadge(meta) {
  if (!meta || meta.simulated) return el("span", { class: "badge badge-demo", "data-provenance": "demo", text: K.badgeDemo });
  return el("span", { class: "badge badge-ai", "data-provenance": "ai", text: K.badgeAi(meta.model || "Claude") + (meta.fallbackUsed ? T.badgeFallback : "") });
}

function kcard(meta, title, ...body) {
  return el("section", { class: "card" }, el("header", { class: "card-head" }, el("h3", { text: title }), provenanceBadge(meta)), ...body);
}

function verificationBanner(v) {
  const box = el("div", { id: "k-verification", class: `verification verification-${v.status}`, "data-status": v.status, role: "note" });
  box.append(el("p", { class: "verification-title" }, el("strong", { text: K.verification[v.status] })));
  box.append(el("p", { text: K.verificationDetail[v.status](v.sourcesUsed) }));
  if (v.status === "not_source_verified" && v.retrievalNote && K.retrievalNote[v.retrievalNote]) {
    box.append(el("p", { class: "muted", text: K.retrievalNote[v.retrievalNote] }));
  }
  if (v.uncitedFacts > 0 && v.status === "source_backed") box.append(el("p", { class: "muted", text: K.uncitedFacts(v.uncitedFacts) }));
  if (v.removedCitations > 0) box.append(el("p", { class: "muted", text: K.removedCitations(v.removedCitations) }));
  return box;
}

/** Real metadata only: publisher, publication date if known, last-edited date if known, retrieval time. */
export function sourceMeta(s) {
  const fmt = (iso) => (iso ? String(iso).slice(0, 10) : null);
  return [s.publisher, fmt(s.publishedAt), s.lastModified ? `${K.lastModified} ${fmt(s.lastModified)}` : null, `${K.retrievedAt} ${fmt(s.retrievedAt)}`]
    .filter(Boolean)
    .join(" · ");
}

function sourceLink(s) {
  if (!isSafeHttpsUrl(s.url)) return el("span", { text: s.title });
  return el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer nofollow", text: s.title });
}

export function createExplorer({ cards, onCardSaved }) {
  const state = { response: null, request: null };

  function renderTopics(topics) {
    const box = $("k-topics");
    clear(box);
    if (!Array.isArray(topics) || topics.length === 0) return;
    box.append(el("p", { class: "muted", text: K.demoTopicsTitle }));
    box.append(
      el(
        "div",
        { class: "chips" },
        ...topics.map((t) =>
          el("button", {
            type: "button",
            class: "chip",
            text: t.topic,
            onclick: () => {
              $("k-question").value = t.topic;
              $("k-question").focus();
            },
          }),
        ),
      ),
    );
  }

  function renderAnswer(r) {
    const out = $("k-result");
    clear(out);
    const a = r.answer;
    out.append(verificationBanner(r.verification));
    // Already shown in the verification banner: demo status and the removed-citation count.
    const nb = noticesBox(r.notices, { skip: ["citations_removed", "demo_content"] });
    if (nb) out.append(nb);

    out.append(
      kcard(
        r.meta,
        a.title,
        ...paragraphs(a.summary),
        a.understood.clarification ? el("p", { class: "alert alert-info", text: a.understood.clarification }) : null,
        el("p", { class: "muted", text: T.confidence[a.confidence] ?? "" }),
      ),
    );

    out.append(
      kcard(
        r.meta,
        K.segmentsTitle,
        el("p", { class: "muted", text: K.segmentsHelp }),
        el(
          "ul",
          { class: "segments" },
          ...a.segments.map((s) =>
            el(
              "li",
              { class: `segment segment-${s.kind}`, "data-kind": s.kind, dir: "auto" },
              el("span", { class: "kind-chip", text: K.kinds[s.kind] ?? s.kind }),
              el("span", { class: "segment-text", text: s.text }),
              s.sourceIds.length ? el("span", { class: "segment-refs", dir: "ltr", text: ` [${s.sourceIds.join(", ")}]` }) : null,
            ),
          ),
        ),
      ),
    );

    if (a.keyConcepts.length) {
      out.append(kcard(r.meta, K.keyConcepts, el("div", { class: "chips" }, ...a.keyConcepts.map((c) => el("span", { class: "chip chip-static", text: c })))));
    }

    // Sources: real retrieved ones only; otherwise an explicit empty state.
    const srcBody = r.sources.length
      ? el(
          "ol",
          { class: "sources" },
          ...r.sources.map((s) =>
            el(
              "li",
              { id: `k-src-${s.id}`, "data-source-id": s.id },
              el("strong", { dir: "ltr", text: `${s.id} · ` }),
              sourceLink(s),
              el("p", { class: "muted source-meta", text: sourceMeta(s) }),
              el("p", { class: "source-excerpt", text: s.excerpt }),
            ),
          ),
        )
      : el("p", { id: "k-no-sources", class: "empty-state", text: r.meta.simulated ? K.noSourcesDemo : K.noSourcesLive });
    const related = r.meta.simulated && r.sources.length > 0;
    const hasWiki = r.sources.some((s) => s.retriever === "wikipedia");
    out.append(
      kcard(
        r.meta,
        related ? K.relatedReadingTitle : K.sourcesTitle,
        related ? el("p", { class: "muted", id: "k-related-help", text: K.relatedReadingHelp }) : null,
        srcBody,
        hasWiki ? el("p", { class: "source-caution", text: K.wikipediaCaution }) : null,
      ),
    );

    if (r.connections.length) {
      out.append(
        kcard(
          r.meta,
          K.connectionsTitle,
          el("p", { class: "muted", text: r.meta.simulated ? K.connectionsHelpDemo : K.connectionsHelp }),
          el(
            "ul",
            { class: "connections" },
            ...r.connections.map((c) =>
              el(
                "li",
                { class: "connection", "data-suggested": "true", dir: "auto" },
                el("span", { class: "badge badge-suggestion", text: K.suggestion }),
                el("strong", { text: ` ${c.concept}: ` }),
                el("span", { text: c.relation }),
                el("button", {
                  type: "button",
                  class: "btn btn-link",
                  text: K.exploreConcept,
                  onclick: () => {
                    $("k-question").value = c.concept;
                    $("k-question").focus();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  },
                }),
              ),
            ),
          ),
        ),
      );
    }

    if (a.caveats.length) out.append(kcard(r.meta, T.caveats, el("ul", { class: "caveats", dir: "auto" }, ...a.caveats.map((c) => el("li", { text: c })))));

    // Learning mode + save card.
    const learning = el("div", { id: "k-learning", "aria-live": "polite" });
    const modeBtn = (mode) =>
      el("button", { type: "button", class: "btn btn-secondary", "data-mode": mode, text: K.modes[mode], onclick: (ev) => runTransform(mode, ev.currentTarget, learning) });
    out.append(
      kcard(r.meta, K.learningTitle, el("p", { class: "muted", text: K.learningHelp }), el("div", { class: "actions wrap" }, modeBtn("simplify"), modeBtn("examples"), modeBtn("quiz")), learning),
    );

    const collection = el("input", { id: "k-collection", type: "text", maxlength: "40", value: K.defaultCollection, "aria-label": K.collectionLabel });
    const saveMsg = el("p", { id: "k-save-msg", class: "muted", role: "status" });
    const saveBtn = el("button", {
      id: "k-save",
      type: "button",
      class: "btn btn-primary",
      text: K.saveCard,
      onclick: () => {
        const res = cards.add(cardFromAnswer(state.response, state.request.language, collection.value.trim() || K.defaultCollection));
        saveMsg.textContent = res.ok ? K.saved : K.saveErrors[res.error] ?? K.saveErrors.invalid;
        if (res.ok) {
          saveBtn.disabled = true;
          onCardSaved?.();
        }
      },
    });
    out.append(
      kcard(r.meta, K.saveTitle, el("p", { class: "muted", text: K.saveHelp }), el("label", { class: "label", for: "k-collection", text: K.collectionLabel }), el("div", { class: "answer-row" }, collection, saveBtn), saveMsg),
    );
  }

  async function runTransform(mode, btn, target) {
    const a = state.response.answer;
    const content = { topic: a.understood.topic.slice(0, 120), summary: a.summary.slice(0, 1200), points: a.segments.map((s) => s.text.slice(0, 1500)).slice(0, 12) };
    for (const b of btn.parentElement.querySelectorAll("button")) b.disabled = true;
    clear(target);
    target.append(el("p", { class: "muted", role: "status", text: K.loadingTransform }));
    const r = await api.transform(mode, state.request.level, state.request.language, content);
    for (const b of btn.parentElement.querySelectorAll("button")) b.disabled = false;
    clear(target);
    if (!r.ok) {
      target.append(el("div", { class: "alert alert-error", role: "alert", text: errorMessage(r) }));
      return;
    }
    target.append(renderTransform(r.data));
  }

  function renderTransform(t) {
    const wrap = el("div", { class: "transform", "data-transform": t.mode });
    wrap.append(el("div", { class: "card-head" }, el("h4", { text: t.result.title }), provenanceBadge(t.meta)));
    const nb = noticesBox(t.notices, { skip: ["demo_content"] });
    if (nb) wrap.append(nb);
    if (t.mode === "simplify") wrap.append(...paragraphs(t.result.text));
    if (t.mode === "examples") wrap.append(el("ul", { class: "examples", dir: "auto" }, ...t.result.examples.map((e) => el("li", {}, el("strong", { text: e.title }), ...paragraphs(e.body)))));
    if (t.mode === "quiz") {
      wrap.append(el("p", { class: "alert alert-info", text: K.selfCheckNote }));
      t.result.questions.forEach((q, i) => wrap.append(quizQuestion(q, i)));
    }
    if (t.result.caveats?.length) wrap.append(el("ul", { class: "caveats", dir: "auto" }, ...t.result.caveats.map((c) => el("li", { text: c }))));
    return wrap;
  }

  /** Self-check question: checked locally in the browser; not graded, not sent, not recorded. */
  function quizQuestion(q, i) {
    const name = `kq-${i}`;
    const feedback = el("div", { class: "quiz-feedback", "aria-live": "polite" });
    const fieldset = el(
      "fieldset",
      { class: "choices" },
      el("legend", { class: "prompt", text: `${i + 1}. ${q.question}` }),
      ...q.choices.map((c) => el("label", { class: "choice" }, el("input", { type: "radio", name, value: c.id }), el("span", { text: c.text }))),
    );
    const check = el("button", {
      type: "button",
      class: "btn btn-secondary",
      text: K.checkSelf,
      onclick: () => {
        const chosen = fieldset.querySelector("input:checked")?.value;
        if (!chosen) return;
        const ok = chosen === q.correctChoiceId;
        clear(feedback);
        feedback.append(
          el("p", { class: ok ? "self-ok" : "self-bad", "data-self-result": ok ? "right" : "wrong", text: ok ? K.selfRight : K.selfWrong }),
          el("p", { text: q.explanation }),
        );
      },
    });
    return el("div", { class: "quiz-q", "data-quiz-question": String(i) }, fieldset, check, feedback);
  }

  async function onAsk(ev) {
    ev.preventDefault();
    const question = $("k-question").value.trim();
    const level = $("k-level").value;
    const language = $("k-language").value;
    const out = $("k-result");
    if (question.length < 3) {
      clear(out);
      out.append(el("div", { class: "alert alert-error", role: "alert", text: K.tooShort }));
      return;
    }
    const btn = $("k-ask");
    btn.disabled = true;
    btn.textContent = K.loading;
    clear(out);
    out.append(el("p", { class: "muted", role: "status", text: K.loading }));
    const r = await api.knowledge(question, level, language);
    btn.disabled = false;
    btn.textContent = K.ask;
    if (!r.ok) {
      clear(out);
      out.append(el("div", { class: "alert alert-error", role: "alert", text: errorMessage(r) }));
      return;
    }
    state.response = r.data;
    state.request = { question, level, language };
    renderAnswer(r.data);
  }

  function initStatic() {
    $("k-title").textContent = K.title;
    $("k-intro").textContent = K.intro;
    $("k-ask-label").textContent = K.askLabel;
    $("k-question").placeholder = K.askPlaceholder;
    $("k-level-label").textContent = T.levelLabel;
    $("k-language-label").textContent = K.languageLabel;
    $("k-ask").textContent = K.ask;
    for (const [v, label] of Object.entries(K.levels)) $("k-level").append(el("option", { value: v, text: label, selected: v === "intermediate" }));
    for (const [v, label] of Object.entries(K.languages)) $("k-language").append(el("option", { value: v, text: label }));
    $("k-empty").textContent = K.empty;
    $("k-form").addEventListener("submit", onAsk);
  }

  return { initStatic, renderTopics };
}
