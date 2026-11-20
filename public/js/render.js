/**
 * DOM helpers. SECURITY: all text is inserted with textContent — never innerHTML —
 * so AI-generated or user-supplied text can never inject HTML or scripts.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Splits text into paragraphs (on blank lines or newlines) as <p> elements. */
export function paragraphs(text) {
  return String(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => el("p", { text: p }));
}
