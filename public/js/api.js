/** Thin JSON client for the SCIORA API (same origin only). */
async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, data: { error: "network" }, retryAfter: null };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: "bad_response" };
  }
  const ra = Number(res.headers.get("retry-after"));
  return { ok: res.ok, status: res.status, data, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
}

export const api = {
  health: () => call("GET", "/api/health"),
  learn: (question, level, language) => call("POST", "/api/learn", { question, level, language }),
  grade: (token, exerciseId, answer) => call("POST", "/api/grade", { token, exerciseId, answer }),
};
