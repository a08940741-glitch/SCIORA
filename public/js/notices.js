import { T } from "./i18n.js";
import { el } from "./render.js";

/**
 * Renders server notice CODES in the interface language.
 * Unknown codes are ignored (never shown raw). `skip` hides codes already shown elsewhere.
 */
export function noticesBox(codes, { skip = [] } = {}) {
  const known = [...new Set(Array.isArray(codes) ? codes : [])].filter((c) => !skip.includes(c) && T.notices[c]);
  if (!known.length) return null;
  return el(
    "div",
    { class: "notices", role: "note", "aria-label": T.noticesTitle },
    el("ul", {}, ...known.map((c) => el("li", { "data-notice": c, text: T.notices[c] }))),
  );
}
