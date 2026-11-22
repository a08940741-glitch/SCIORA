import { T } from "./i18n.js";
import { el, clear } from "./render.js";
import { isSafeHttpsUrl, MAX_CARDS } from "./cards-store.js";

/** "My cards" panel. Cards live only in this browser (see cards-store.js). */
const K = T.k;
const $ = (id) => document.getElementById(id);

export function createCardsPanel(cards) {
  const state = { search: "", collection: "" };

  function statusBadge(c) {
    return el("span", { class: `badge status-${c.verificationStatus}`, "data-card-status": c.verificationStatus, text: K.cardStatus[c.verificationStatus] });
  }

  function cardItem(c) {
    const checked = el("button", {
      type: "button",
      class: "btn btn-secondary",
      "aria-pressed": String(c.checkedByMe),
      "data-action": "checked",
      text: c.checkedByMe ? K.uncheckMine : K.checkMine,
      onclick: () => {
        cards.update(c.id, { checkedByMe: !c.checkedByMe });
        render();
      },
    });
    const move = el("button", {
      type: "button",
      class: "btn btn-link",
      "data-action": "move",
      text: K.moveCard,
      onclick: () => {
        const next = window.prompt(K.movePrompt, c.collection);
        if (next && next.trim()) {
          cards.update(c.id, { collection: next.trim() });
          render();
        }
      },
    });
    const del = el("button", {
      type: "button",
      class: "btn btn-link btn-danger",
      "data-action": "delete",
      text: K.deleteCard,
      onclick: () => {
        if (!window.confirm(K.deleteConfirm)) return;
        cards.remove(c.id);
        render();
      },
    });
    const date = new Date(c.createdAt);
    return el(
      "article",
      { class: "card kcard", "data-card-id": c.id },
      el("header", { class: "card-head" }, el("h3", { text: c.title }), el("div", { class: "badges" }, statusBadge(c), c.checkedByMe ? el("span", { class: "badge badge-checked", "data-checked": "true", text: K.checkedBadge }) : null)),
      el("p", { class: "muted", text: `${K.collection}: ${c.collection} · ${isNaN(date) ? "" : date.toLocaleDateString("en-GB")}` }),
      el("p", { text: c.summary }),
      c.keyConcepts.length ? el("div", { class: "chips" }, ...c.keyConcepts.map((k) => el("span", { class: "chip chip-static", text: k }))) : null,
      c.sources.length
        ? el("ul", { class: "sources" }, ...c.sources.map((s) => el("li", {}, isSafeHttpsUrl(s.url) ? el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer nofollow", text: s.title }) : el("span", { text: s.title }))))
        : el("p", { class: "muted", text: c.origin === "demo" ? K.cardNoSourcesDemo : K.cardNoSources }),
      el("div", { class: "actions wrap" }, checked, move, del),
    );
  }

  function render() {
    const sel = $("c-collection");
    const current = state.collection;
    clear(sel);
    sel.append(el("option", { value: "", text: K.allCollections }));
    for (const c of cards.collections()) sel.append(el("option", { value: c, text: c, selected: c === current }));
    const list = $("c-list");
    clear(list);
    const items = cards.list({ collection: state.collection || null, search: state.search });
    $("c-count").textContent = K.cardCount(cards.count(), MAX_CARDS);
    if (cards.count() === 0) {
      list.append(el("p", { class: "empty-state", id: "c-empty", text: K.noCards }));
      return;
    }
    if (items.length === 0) {
      list.append(el("p", { class: "empty-state", text: K.noMatches }));
      return;
    }
    for (const c of items) list.append(cardItem(c));
  }

  function exportCards() {
    const blob = new Blob([cards.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "sciora-cards.json" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function initStatic() {
    $("c-title").textContent = K.cardsTitle;
    $("c-intro").textContent = K.cardsIntro;
    $("c-search").placeholder = K.searchPlaceholder;
    $("c-search").setAttribute("aria-label", K.searchPlaceholder);
    $("c-collection").setAttribute("aria-label", K.collection);
    $("c-export").textContent = K.exportCards;
    $("c-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      render();
    });
    $("c-collection").addEventListener("change", (e) => {
      state.collection = e.target.value;
      render();
    });
    $("c-export").addEventListener("click", exportCards);
  }

  return { initStatic, render };
}
