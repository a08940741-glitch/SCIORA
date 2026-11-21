import { api } from "./api.js";
import { T, UI_LANG, UI_DIR, UI_LANGUAGES, DEFAULT_CONTENT_LANGUAGE, demoTitle, setUiLanguage } from "./i18n.js";
import { noticesBox } from "./notices.js";
import { summarizeSession, nextLevel } from "./session.js";
import { el, clear, paragraphs } from "./render.js";
import { createLearnerModel } from "./learner-model.js";
import { errorMessage } from "./errors.js";
import { createCardStore } from "./cards-store.js";
import { createExplorer } from "./explorer.js";
import { createCardsPanel } from "./cards.js";
import { createEvidencePanel } from "./evidence.js";
import { createProgressPanel } from "./progress.js";

const learner = createLearnerModel(window.localStorage);
const $ = (id) => document.getElementById(id);

const state = { mode: null, lesson: null, meta: null, token: null, level: "school", topic: null, notices: [], results: {} };

// ------------------------------------------------------------------ provenance labels

function provenanceBadge(meta) {
  if (!meta || meta.simulated) return el("span", { class: "badge badge-demo", "data-provenance": "demo", text: T.badgeDemo });
  const text = T.badgeLive(meta.model || "Claude") + (meta.fallbackUsed ? T.badgeFallback : "");
  return el("span", { class: "badge badge-ai", "data-provenance": "ai", text });
}

function card(title, ...body) {
  return el("section", { class: "card" }, el("header", { class: "card-head" }, el("h3", { text: title }), provenanceBadge(state.meta)), ...body);
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
    return null;
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
        el(
          "button",
          {
            type: "button",
            class: "chip",
            onclick: () => {
              $("question").value = demoTitle(t.topic, t.topicEn);
              $("question").focus();
            },
          },
          // Interface label (subject) and content (topic) are isolated so mixed scripts keep their order.
          el("span", { class: "chip-label", text: T.subjects[t.subject] ?? t.subject }),
          " · ",
          el("bdi", { text: demoTitle(t.topic, t.topicEn) }),
        ),
      );
    }
    topics.append(list);
  }
  return r.data;
}

// ------------------------------------------------------------------ lesson

async function onAsk(ev) {
  ev.preventDefault();
  const question = $("question").value.trim();
  const level = $("level").value;
  const language = $("language").value;
  const out = $("lesson");
  if (question.length < 3) {
    showError(out, T.k.tooShort);
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
  state.language = language;
  state.topic = r.data.lesson.understood.topic;
  state.notices = r.data.notices ?? [];
  state.results = {};
  renderLesson(r.data.lesson);
  renderExercises(r.data.lesson.exercises);
  renderEstimate();
}

function renderLesson(lesson) {
  const out = $("lesson");
  clear(out);
  const nb = noticesBox(state.notices);
  if (nb) out.append(nb);
  const u = lesson.understood;
  out.append(
    card(
      T.understood,
      el("p", { dir: "auto" }, el("strong", { text: u.topic }), ` · ${T.subjects[u.subject] ?? u.subject}`),
      u.clarification ? el("p", { class: "alert alert-info", text: u.clarification }) : null,
      el("p", { class: "muted", text: T.confidence[lesson.confidence] ?? "" }),
    ),
  );
  if (!u.isEducational) return;
  // This field is a simple explanation in Darija, except for English lessons (plain English).
  out.append(card(state.language === "en" ? T.explanationSimple : T.explanationDarija, ...paragraphs(lesson.explanationDarija)));
  out.append(card(T.explanationFormal, ...paragraphs(lesson.explanationFormal)));
  out.append(card(T.steps, el("ol", { dir: "auto", class: "content-list" }, ...lesson.steps.map((s) => el("li", { text: s })))));

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
    out.append(card(T.caveats, el("ul", { class: "caveats", dir: "auto" }, ...lesson.caveats.map((c) => el("li", { text: c })))));
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

// ------------------------------------------------------------------ session summary (evaluate → improve)

function renderSessionSummary() {
  const total = state.lesson?.exercises?.length ?? 0;
  const s = summarizeSession(Object.values(state.results), total);
  $("session-summary")?.remove();
  if (!s.done) return;
  const S = T.session;
  const askAgain = (level) => {
    if (level) $("level").value = level;
    $("question").value = state.topic;
    $("ask-form").requestSubmit();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const buttons = [];
  if (s.recommendation === "next_level" && state.level !== "advanced") {
    buttons.push(el("button", { type: "button", class: "btn btn-primary", "data-action": "next-level", text: S.nextLevelBtn(T.levels[nextLevel(state.level)]), onclick: () => askAgain(nextLevel(state.level)) }));
  }
  buttons.push(el("button", { type: "button", class: s.recommendation === "next_level" ? "btn btn-secondary" : "btn btn-primary", "data-action": "retry", text: S.retryBtn, onclick: () => askAgain(null) }));
  buttons.push(
    el("button", {
      type: "button",
      class: "btn btn-secondary",
      "data-action": "explore",
      text: S.exploreBtn,
      onclick: () => {
        selectTab("explore", true);
        $("k-question").value = state.topic;
        $("k-question").focus();
      },
    }),
  );
  const c = s.counts;
  $("exercises").append(
    el(
      "section",
      { class: "card session-summary", id: "session-summary", "data-recommendation": s.recommendation },
      el("header", { class: "card-head" }, el("h3", { text: S.title })),
      el(
        "div",
        { class: "stats" },
        ...[["correct", c.correct], ["partially_correct", c.partially_correct], ["incorrect", c.incorrect], ["uncertain", c.uncertain]].map(([k, v]) =>
          el("div", { class: `stat stat-${k}` }, el("span", { class: "stat-value", text: String(v) }), el("span", { class: "stat-label", text: T.verdicts[k] })),
        ),
      ),
      el("p", { class: "label", text: S.gapsTitle }),
      s.gaps.length ? el("ul", { class: "gaps", dir: "auto" }, ...s.gaps.map((g) => el("li", { text: g }))) : el("p", { class: "muted", text: S.noGaps }),
      c.uncertain ? el("p", { class: "muted", text: S.uncertainNote }) : null,
      el("p", { class: "label", text: S.nextTitle }),
      el("p", { class: "recommendation", text: S.next[s.recommendation] }),
      el("div", { class: "actions wrap" }, ...buttons),
    ),
  );
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
    state.results[ex.id] = graded;
    renderSessionSummary();
    return;
  }
  ui.checkBtn.disabled = false;
  showError(ui.result, errorMessage(r, { exerciseType: ex.type }));
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
        ...g.criteria.map((c) => el("li", { class: `crit crit-${c.judgement}`, dir: "auto" }, el("span", { class: "crit-state", text: T.criterionState[c.judgement] ?? c.judgement }), " ", el("span", { text: c.description }))),
      ),
    );
  }
  if (g.misconception) box.append(el("p", { class: "alert alert-info" }, el("strong", { text: `${T.misconception}: ` }), el("span", { text: g.misconception })));
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

function initInterfaceLanguage() {
  document.documentElement.lang = UI_LANG;
  document.documentElement.dir = UI_DIR;
  document.title = T.ui.title;
  $("skip-link").textContent = T.ui.skip;
  $("footer").textContent = T.ui.footer;
  $("ui-lang-label").textContent = T.ui.interfaceLabel;
  const sel = $("ui-lang");
  for (const l of UI_LANGUAGES) sel.append(el("option", { value: l, text: T.ui.interfaceNames[l], selected: l === UI_LANG, lang: l }));
  sel.addEventListener("change", () => {
    if (setUiLanguage(sel.value)) window.location.reload();
  });
  $("hero-title").textContent = T.ui.heroTitle;
  $("hero-text").textContent = T.ui.heroText;
  for (const b of document.querySelectorAll(".pillar")) {
    const p = T.ui.pillars[b.dataset.goto];
    b.querySelector(".pillar-title").textContent = p.title;
    b.querySelector(".pillar-text").textContent = p.text;
    b.addEventListener("click", () => {
      selectTab(b.dataset.goto, true);
      document.getElementById("main").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  $("learn-title").textContent = T.tabs.learn;
  $("learn-intro").textContent = T.ui.learnIntro;
}

function initStatic() {
  $("tagline").textContent = T.appTagline;
  $("ask-label").textContent = T.askLabel;
  $("question").placeholder = T.askPlaceholder;
  $("level-label").textContent = T.levelLabel;
  $("language-label").textContent = T.languageLabel;
  $("ask-btn").textContent = T.submit;
  for (const [v, label] of Object.entries(T.levels)) $("level").append(el("option", { value: v, text: label, selected: v === "school" }));
  for (const [v, label] of Object.entries(T.languages)) $("language").append(el("option", { value: v, text: label }));
  $("language").value = DEFAULT_CONTENT_LANGUAGE;
  $("estimate-title").textContent = T.estimateTitle;
  $("clear-btn").textContent = T.clearData;
  $("responsible-title").textContent = T.responsibleTitle;
  const list = $("responsible-list");
  for (const line of T.responsible) list.append(el("li", { text: line }));
  $("phase-note").textContent = T.phaseNote;
}

// ------------------------------------------------------------------ tabs (Phase 2A)

const cardStore = createCardStore(window.localStorage);
const cardsPanel = createCardsPanel(cardStore);
const explorer = createExplorer({
  cards: cardStore,
  onCardSaved: () => cardsPanel.render(),
  // Knowledge → Evidence: check an individual fact from an answer in the Evidence Analyzer.
  onCheckClaim: (text, language) => {
    selectTab("evidence", true);
    $("e-claim").value = text.slice(0, 1000);
    if ([...$("e-language").options].some((o) => o.value === language)) $("e-language").value = language;
    $("e-form").requestSubmit();
  },
});
const evidencePanel = createEvidencePanel();
const progressPanel = createProgressPanel({
  learner,
  cards: cardStore,
  onReview: (topic, level) => {
    selectTab("learn");
    $("question").value = topic;
    if ([...$("level").options].some((o) => o.value === level)) $("level").value = level;
    $("question").focus();
  },
});
const TABS = ["learn", "explore", "evidence", "cards", "progress"];

function selectTab(name, focus = false) {
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    const panel = $(`panel-${t}`);
    const on = t === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    if (on && focus) tab.focus();
  }
  if (name === "cards") cardsPanel.render();
  if (name === "progress") progressPanel.render();
}

function initTabs() {
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    tab.querySelector(".tab-label").textContent = T.tabs[t];
    tab.addEventListener("click", () => selectTab(t));
    tab.addEventListener("keydown", (ev) => {
      const i = TABS.indexOf(t);
      // Direction-aware: the "next" arrow is ArrowRight in LTR and ArrowLeft in RTL.
      const nextKey = UI_DIR === "rtl" ? "ArrowLeft" : "ArrowRight";
      const prevKey = UI_DIR === "rtl" ? "ArrowRight" : "ArrowLeft";
      // Vertical sidebar: ArrowDown / ArrowUp also move between tabs.
      if (ev.key === nextKey || ev.key === "ArrowDown") selectTab(TABS[(i + 1) % TABS.length], true);
      else if (ev.key === prevKey || ev.key === "ArrowUp") selectTab(TABS[(i + TABS.length - 1) % TABS.length], true);
      else if (ev.key === "Home") selectTab(TABS[0], true);
      else if (ev.key === "End") selectTab(TABS[TABS.length - 1], true);
      else return;
      ev.preventDefault();
    });
  }
  selectTab("learn");
}

initStatic();
initInterfaceLanguage();
renderEstimate();
$("ask-form").addEventListener("submit", onAsk);
$("clear-btn").addEventListener("click", onClearData);
initTabs();
explorer.initStatic();
evidencePanel.initStatic();
cardsPanel.initStatic();
progressPanel.initStatic();
loadHealth().then((h) => {
  explorer.renderTopics(h?.knowledge?.demoTopics ?? []);
  evidencePanel.renderClaims(h?.evidence?.demoClaims ?? []);
});
