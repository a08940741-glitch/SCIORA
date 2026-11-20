import { api } from "./api.js";
import { T } from "./i18n.js";
import { el, clear, paragraphs } from "./render.js";
import { createLearnerModel } from "./learner-model.js";

const learner = createLearnerModel(window.localStorage);
const $ = (id) => document.getElementById(id);

const state = { mode: null, lesson: null, meta: null, token: null, level: "school", topic: null };

// ------------------------------------------------------------------ provenance labels

function provenanceBadge(meta) {
  if (!meta || meta.simulated) return el("span", { class: "badge badge-demo", "data-provenance": "demo", text: T.badgeDemo });
  const text = T.badgeLive(meta.model || "Claude") + (meta.fallbackUsed ? T.badgeFallback : "");
  return el("span", { class: "badge badge-ai", "data-provenance": "ai", text });
}

function card(title, ...body) {
  return el("section", { class: "card" }, el("header", { class: "card-head" }, el("h3", { text: title }), provenanceBadge(state.meta)), ...body);
}

/** Localized message for a failed API call. 422 unreadable_answer keeps the server's localized hint. */
function errorMessage(r) {
  if (r.status === 0) return T.errors.network;
  const code = r.data?.error;
  if (code === "unreadable_answer" && r.data?.message) return r.data.message;
  return T.errorCodes[code] ?? r.data?.message ?? T.errors.generic;
}

function showError(target, message) {
  clear(target);
  target.append(el("div", { class: "alert alert-error", role: "alert", text: message }));
}

// ------------------------------------------------------------------ health / mode banner

async function loadHealth() {
  const banner = $("mode-banner");
  const r = await api.health();
  if (!r.ok) {
    banner.className = "mode-banner mode-unknown";
    banner.textContent = T.modeUnknown;
    return;
  }
  state.mode = r.data.mode;
  banner.className = `mode-banner ${r.data.simulated ? "mode-demo" : "mode-live"}`;
  banner.dataset.mode = r.data.mode;
  banner.textContent = r.data.simulated ? T.modeDemo : T.modeLive;

  const topics = $("demo-topics");
  clear(topics);
  if (r.data.simulated && Array.isArray(r.data.demoTopics)) {
    topics.append(el("p", { class: "muted", text: T.demoTopicsTitle }));
    const list = el("div", { class: "chips" });
    for (const t of r.data.demoTopics) {
      list.append(
        el("button", {
          type: "button",
          class: "chip",
          text: `${t.topic} · ${T.subjects[t.subject] ?? t.subject}`,
          onclick: () => {
            $("question").value = t.topic;
            $("question").focus();
          },
        }),
      );
    }
    topics.append(list);
  }
}

// ------------------------------------------------------------------ lesson

async function onAsk(ev) {
  ev.preventDefault();
  const question = $("question").value.trim();
  const level = $("level").value;
  const language = $("language").value;
  const out = $("lesson");
  if (question.length < 3) {
    showError(out, "السؤال قصير بزاف.");
    return;
  }
  const btn = $("ask-btn");
  btn.disabled = true;
  btn.textContent = T.loading;
  clear(out);
  clear($("exercises"));
  out.append(el("p", { class: "muted", role: "status", text: T.loading }));

  const r = await api.learn(question, level, language);
  btn.disabled = false;
  btn.textContent = T.submit;

  if (!r.ok) {
    showError(out, errorMessage(r));
    return;
  }
  state.lesson = r.data.lesson;
  state.meta = r.data.meta;
  state.token = r.data.exerciseSet?.token ?? null;
  state.level = level;
  state.topic = r.data.lesson.understood.topic;
  renderLesson(r.data.lesson);
  renderExercises(r.data.lesson.exercises);
  renderEstimate();
}

function renderLesson(lesson) {
  const out = $("lesson");
  clear(out);
  const u = lesson.understood;
  out.append(
    card(
      T.understood,
      el("p", {}, el("strong", { text: u.topic }), ` · ${T.subjects[u.subject] ?? u.subject}`),
      u.clarification ? el("p", { class: "alert alert-info", text: u.clarification }) : null,
      el("p", { class: "muted", text: T.confidence[lesson.confidence] ?? "" }),
    ),
  );
  if (!u.isEducational) return;
  out.append(card(T.explanationDarija, ...paragraphs(lesson.explanationDarija)));
  out.append(card(T.explanationFormal, ...paragraphs(lesson.explanationFormal)));
  out.append(card(T.steps, el("ol", {}, ...lesson.steps.map((s) => el("li", { text: s })))));

  const solution = el("div", { class: "solution", hidden: true }, ...paragraphs(lesson.example.solution));
  const toggle = el("button", {
    type: "button",
    class: "btn btn-secondary",
    text: T.showSolution,
    "aria-expanded": "false",
    onclick: () => {
      solution.hidden = !solution.hidden;
      toggle.textContent = solution.hidden ? T.showSolution : T.hideSolution;
      toggle.setAttribute("aria-expanded", String(!solution.hidden));
    },
  });
  out.append(card(T.example, ...paragraphs(lesson.example.problem), toggle, solution));

  if (lesson.caveats.length) {
    out.append(card(T.caveats, el("ul", { class: "caveats" }, ...lesson.caveats.map((c) => el("li", { text: c })))));
  }
}

// ------------------------------------------------------------------ exercises

function renderExercises(exercises) {
  const box = $("exercises");
  clear(box);
  if (!exercises.length || !state.token) return;
  box.append(el("h2", { text: T.exercises }), el("p", { class: "muted", text: T.oneAttempt }));
  exercises.forEach((ex, i) => box.append(exerciseCard(ex, i + 1)));
}

function exerciseCard(ex, index) {
  const name = `ans-${ex.id}`;
  let input;
  let getAnswer;
  if (ex.type === "mcq") {
    input = el(
      "fieldset",
      { class: "choices" },
      el("legend", { class: "sr-only", text: ex.prompt }),
      ...ex.choices.map((c) =>
        el("label", { class: "choice" }, el("input", { type: "radio", name, value: c.id }), el("span", { text: c.text })),
      ),
    );
    getAnswer = () => input.querySelector("input:checked")?.value ?? "";
  } else if (ex.type === "short_text") {
    input = el("textarea", { rows: "3", maxlength: "2000", placeholder: T.answerPlaceholderText, "aria-label": ex.prompt });
    getAnswer = () => input.value.trim();
  } else {
    input = el("input", {
      type: "text",
      dir: "ltr",
      maxlength: "200",
      inputmode: ex.type === "numeric" ? "decimal" : "text",
      placeholder: ex.type === "numeric" ? T.answerPlaceholderNumeric : T.answerPlaceholderExpression,
      "aria-label": ex.prompt,
    });
    getAnswer = () => input.value.trim();
  }

  const hint = el("p", { class: "hint", hidden: true, text: ex.hint });
  const hintBtn = el("button", {
    type: "button",
    class: "btn btn-link",
    text: T.hint,
    onclick: () => {
      hint.hidden = !hint.hidden;
      hintBtn.textContent = hint.hidden ? T.hint : T.hideHint;
    },
  });
  const result = el("div", { class: "result", "aria-live": "polite" });
  const checkBtn = el("button", { type: "submit", class: "btn btn-primary", text: T.check });
  const unit = ex.type === "numeric" && ex.unit ? el("span", { class: "unit", dir: "ltr", text: ex.unit }) : null;

  const form = el(
    "form",
    { class: "exercise", "data-exercise-id": ex.id, "data-exercise-type": ex.type, novalidate: true },
    el("p", { class: "prompt", text: ex.prompt }),
    el("div", { class: "answer-row" }, input, unit),
    el("div", { class: "actions" }, checkBtn, hintBtn),
    hint,
    result,
  );
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    submitAnswer(ex, getAnswer(), { form, checkBtn, result });
  });

  return el(
    "section",
    { class: "card" },
    el("header", { class: "card-head" }, el("h3", { text: T.exercise(index) }), provenanceBadge(state.meta)),
    form,
  );
}

async function submitAnswer(ex, answer, ui, attempt = 1) {
  if (!answer) return;
  ui.checkBtn.disabled = true;
  ui.checkBtn.textContent = T.checking;
  const r = await api.grade(state.token, ex.id, answer);

  if (r.status === 409 && r.data?.error === "grading_in_progress" && attempt < 6) {
    setTimeout(() => submitAnswer(ex, answer, ui, attempt + 1), (r.retryAfter ?? 2) * 1000);
    return;
  }
  ui.checkBtn.textContent = T.check;

  const graded = r.ok ? r.data.result : r.status === 409 && r.data?.result ? r.data.result : null;
  if (graded) {
    lockForm(ui.form);
    renderResult(ui.result, graded);
    if (!graded.replayed) {
      learner.record(state.topic, state.level, graded);
      renderEstimate();
    }
    return;
  }
  ui.checkBtn.disabled = false;
  showError(ui.result, errorMessage(r));
}

function lockForm(form) {
  for (const c of form.querySelectorAll("input, textarea, button[type=submit]")) c.disabled = true;
}

function renderResult(target, g) {
  clear(target);
  const box = el("div", { class: `verdict verdict-${g.verdict}`, "data-verdict": g.verdict });
  box.append(el("p", { class: "verdict-title" }, el("strong", { text: T.verdicts[g.verdict] ?? g.verdict }), g.score !== null && g.score !== undefined ? ` · ${T.score(g.score)}` : ""));
  if (g.replayed) box.append(el("p", { class: "muted", text: T.replayed }));
  box.append(el("p", { text: g.feedback }));
  if (g.verdict === "uncertain") {
    box.append(el("p", { class: "alert alert-warn", text: T.uncertainHelp }));
    if (g.uncertaintyReason) box.append(el("p", { class: "muted", text: g.uncertaintyReason }));
  }
  if (g.criteria?.length) {
    box.append(
      el("p", { class: "label", text: T.criteria }),
      el(
        "ul",
        { class: "criteria" },
        ...g.criteria.map((c) => el("li", { class: `crit crit-${c.judgement}` }, el("span", { class: "crit-state", text: T.criterionState[c.judgement] ?? c.judgement }), ` ${c.description}`)),
      ),
    );
  }
  if (g.misconception) box.append(el("p", { class: "alert alert-info" }, el("strong", { text: `${T.misconception}: ` }), g.misconception));
  box.append(el("p", { class: "label", text: T.correctAnswer }), el("p", { class: "correct-answer", text: g.correctAnswer }));
  box.append(el("p", { class: "label", text: T.explanation }), ...paragraphs(g.explanation));

  const by = g.gradedBy || {};
  const byText = by.source === "rules" ? T.gradedByRules : by.simulated ? T.gradedByDemo : T.gradedByAi(by.model || "Claude");
  box.append(el("p", { class: `graded-by ${by.simulated ? "graded-demo" : ""}`, "data-graded-by": by.source, text: byText }));
  target.append(box);
}

// ------------------------------------------------------------------ preliminary estimate

function renderEstimate() {
  const box = $("estimate-body");
  clear(box);
  const est = state.topic ? learner.estimate(state.topic) : null;
  if (!est) {
    box.append(el("p", { class: "muted", text: T.estimateNone }));
  } else {
    box.append(
      el("p", { class: "estimate-topic", text: est.topic }),
      el("p", { class: "estimate-line", "data-answers": String(est.basedOnAnswers), text: T.estimateLine(T.levels[est.estimatedLevel], est.basedOnAnswers, T.estimateConfidence[est.confidence]) }),
      el("p", { class: "muted", text: T.estimateSuggest(T.levels[est.estimatedLevel]) }),
    );
  }
  box.append(el("p", { class: "estimate-note", text: T.estimateNote }));
}

function onClearData() {
  if (!window.confirm(T.clearConfirm)) return;
  learner.clear();
  renderEstimate();
  const msg = $("clear-msg");
  msg.textContent = T.cleared;
}

// ------------------------------------------------------------------ init

function initStatic() {
  $("tagline").textContent = T.appTagline;
  $("ask-label").textContent = T.askLabel;
  $("question").placeholder = T.askPlaceholder;
  $("level-label").textContent = T.levelLabel;
  $("language-label").textContent = T.languageLabel;
  $("ask-btn").textContent = T.submit;
  for (const [v, label] of Object.entries(T.levels)) $("level").append(el("option", { value: v, text: label, selected: v === "school" }));
  for (const [v, label] of Object.entries(T.languages)) $("language").append(el("option", { value: v, text: label }));
  $("estimate-title").textContent = T.estimateTitle;
  $("clear-btn").textContent = T.clearData;
  $("responsible-title").textContent = T.responsibleTitle;
  const list = $("responsible-list");
  for (const line of T.responsible) list.append(el("li", { text: line }));
  $("phase-note").textContent = T.phaseNote;
}

initStatic();
renderEstimate();
$("ask-form").addEventListener("submit", onAsk);
$("clear-btn").addEventListener("click", onClearData);
loadHealth();
