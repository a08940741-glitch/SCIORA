import { T } from "./i18n.js";
import { el, clear } from "./render.js";
import { summarizeProgress } from "./learner-model.js";

/**
 * Learning Progress panel. Shows ONLY data stored in this browser:
 * graded answers (preliminary level estimate per topic) and saved knowledge cards.
 * Recommendations are simple rules (see summarizeProgress), presented as suggestions.
 */
const P = T.p;
const $ = (id) => document.getElementById(id);

export function createProgressPanel({ learner, cards, onReview }) {
  function stat(label, value, id) {
    return el("div", { class: "stat", id }, el("span", { class: "stat-value", text: String(value) }), el("span", { class: "stat-label", text: label }));
  }

  function topicRow(t) {
    const rec = t.recommendation;
    return el(
      "article",
      { class: `card progress-topic${t.needsReview ? " needs-review" : ""}`, "data-progress-topic": t.topic, "data-recommendation": rec.kind },
      el("header", { class: "card-head" }, el("h3", { text: t.topic }), t.needsReview ? el("span", { class: "badge badge-review", text: P.needsReview }) : null),
      el("p", { class: "estimate-line", text: T.estimateLine(T.levels[t.estimatedLevel], t.basedOnAnswers, T.estimateConfidence[t.confidence]) }),
      el(
        "p",
        { class: "muted" },
        `${T.verdicts.correct}: ${t.counts.correct} · ${T.verdicts.partially_correct}: ${t.counts.partially_correct} · ${T.verdicts.incorrect}: ${t.counts.incorrect}`,
      ),
      el("p", { class: "recommendation", text: P.recommendations[rec.kind](T.levels[rec.level]) }),
      el("button", {
        type: "button",
        class: "btn btn-secondary",
        "data-action": "practice",
        text: P.practiceButton,
        onclick: () => onReview(t.topic, rec.level),
      }),
    );
  }

  function render() {
    const box = $("p-body");
    clear(box);
    const summary = summarizeProgress(learner.allTopics());
    const cardCount = cards.count();
    box.append(
      el(
        "div",
        { class: "stats" },
        stat(P.statTopics, summary.totals.topics, "p-stat-topics"),
        stat(P.statGraded, summary.totals.graded, "p-stat-graded"),
        stat(P.statCorrect, summary.totals.correct, "p-stat-correct"),
        stat(P.statCards, cardCount, "p-stat-cards"),
      ),
    );
    if (summary.totals.topics === 0) {
      box.append(el("p", { class: "empty-state", id: "p-empty", text: P.empty }));
      return;
    }
    if (summary.needsReview.length) {
      box.append(el("h3", { class: "section-title", text: P.reviewTitle }), el("p", { class: "muted", text: P.reviewHelp }));
    }
    for (const t of summary.topics) box.append(topicRow(t));
  }

  function initStatic() {
    $("p-title").textContent = P.title;
    $("p-intro").textContent = P.intro;
    $("p-note").textContent = T.estimateNote;
  }

  return { initStatic, render };
}
