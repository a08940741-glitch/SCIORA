import { GroqClient, type FetchLike } from "../../src/ai/groq-client.ts";

/** Clearly fake key used only in tests (never a real credential). */
export const FAKE_GROQ_KEY = "fake-groq-key-for-tests-0000000000";

export type GroqStep =
  | { status?: number; body?: unknown; rawBody?: string; headers?: Record<string, string> }
  | Error
  | ((init: RequestInit) => Promise<Response>);

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: any;
  signal: AbortSignal | null | undefined;
}

/**
 * Fake fetch for the Groq client: returns scripted HTTP responses and records every request.
 * NO network: nothing here can reach api.groq.com.
 */
export function fakeGroqFetch(steps: GroqStep[]) {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) }, body: JSON.parse(String(init.body)), signal: init.signal });
    const step = steps[Math.min(i++, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(init);
    const text = step.rawBody ?? JSON.stringify(step.body ?? {});
    return new Response(text, { status: step.status ?? 200, headers: { "content-type": "application/json", ...(step.headers ?? {}) } });
  };
  return { fetchFn, calls };
}

export function fakeGroqClient(steps: GroqStep[]) {
  const { fetchFn, calls } = fakeGroqFetch(steps);
  return { client: new GroqClient({ apiKey: FAKE_GROQ_KEY, fetch: fetchFn }), calls };
}

/** A successful chat completion whose message content is the JSON of `parsed`. */
export function groqOk(parsed: unknown, model = "openai/gpt-oss-120b", finishReason = "stop") {
  return {
    status: 200,
    body: {
      id: "chatcmpl-fake",
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(parsed) }, finish_reason: finishReason }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  };
}

/** A completion with arbitrary message content (for malformed / truncated cases). */
export function groqRaw(content: unknown, finishReason = "stop", extraMessage: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: { model: "openai/gpt-oss-120b", choices: [{ index: 0, message: { role: "assistant", content, ...extraMessage }, finish_reason: finishReason }] },
  };
}

/** A fake fetch that waits until the request's abort signal fires (to test timeouts). */
export function hangingStep(): GroqStep {
  return (init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}
