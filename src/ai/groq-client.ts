import type { z } from "zod";
import { ProviderError } from "./provider.ts";
import { toGroqStrictSchema } from "./groq-schema.ts";
import { findNonEnglishOutput } from "../domain/english-only.ts";

/**
 * Groq client over its official OpenAI-compatible Chat Completions API, using Node's built-in
 * fetch (no extra package). NOT yet exercised against the real API (no live calls without
 * owner approval).
 *
 * Safety rules:
 * - The API key is held only in this object (server side) and sent only in the
 *   Authorization header. It never appears in errors, logs or responses.
 * - Provider error bodies are never read into messages or logs (they may echo input).
 * - Conservative retries: 429, 5xx, timeouts, network errors AND cut-off output
 *   (finish_reason "length": the same request would be cut off again) are NOT retried
 *   (free-tier friendly). Only malformed JSON, a schema mismatch or clearly non-English
 *   output (English-only policy) is retried once.
 *   At most 2 HTTP requests per call.
 * - Response bodies are capped at MAX_GROQ_RESPONSE_BYTES (Content-Length and streamed).
 * - One timeout covers the whole request: waiting for headers AND reading the body.
 * - Partial or invalid output is never returned.
 */

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Largest accepted response body. A full lesson is well under 100 KB of JSON. */
export const MAX_GROQ_RESPONSE_BYTES = 1024 * 1024;

/** fetch-compatible function; tests inject a fake (no network). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GroqClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Override the response size cap (tests). */
  maxResponseBytes?: number;
}

export class GroqClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #url: string;

  readonly #maxBytes: number;

  constructor(opts: GroqClientOptions) {
    if (!opts.apiKey) throw new Error("GroqClient requires an API key");
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.#url = `${opts.baseUrl ?? GROQ_BASE_URL}/chat/completions`;
    this.#maxBytes = opts.maxResponseBytes ?? MAX_GROQ_RESPONSE_BYTES;
  }

  /** Never reveal the key through inspection or serialization. */
  toJSON() {
    return { provider: "groq" };
  }

  /** One HTTP request. Returns the parsed JSON body on HTTP 2xx; throws ProviderError otherwise. */
  async chat(body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    // Explicit timer (not AbortSignal.timeout, whose timer is unref'd) covering the whole
    // request INCLUDING reading the body; always cleared.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("The request timed out.", "TimeoutError")), timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.#fetch(this.#url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        throw transportError(err, controller.signal);
      }
      if (!res.ok) {
        res.body?.cancel().catch(() => {}); // the error body is deliberately never read
        throw mapGroqStatus(res);
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.#maxBytes) {
        res.body?.cancel().catch(() => {});
        throw tooLarge();
      }
      let text: string;
      try {
        text = await readCapped(res, this.#maxBytes, controller.signal);
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw transportError(err, controller.signal);
      }
      try {
        return JSON.parse(text);
      } catch {
        return undefined; // not JSON: treated as an unusable response by the caller
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function tooLarge(): ProviderError {
  return new ProviderError("bad_output", "The AI response was too large.");
}

/**
 * Reads the body as UTF-8, stopping (and cancelling the stream) once it exceeds maxBytes.
 * Every read also races the abort signal, so the timeout applies even if a stream ignores aborts.
 */
async function readCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {}); // handled by the race below; avoids an unhandled rejection
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await Promise.race([reader.read(), aborted]);
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }
    const { done, value } = step;
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** Network or timeout failure → SCIORA error. The original error text is never exposed. */
function transportError(err: unknown, signal: AbortSignal): ProviderError {
  const name = (err as Error)?.name;
  if (signal.aborted || name === "TimeoutError" || name === "AbortError") {
    return new ProviderError("unavailable", "The AI service did not respond in time.");
  }
  return new ProviderError("unavailable", "The AI service could not be reached.");
}

/** Maps an HTTP error status to a SCIORA error. The response body is deliberately ignored. */
export function mapGroqStatus(res: Pick<Response, "status" | "headers">): ProviderError {
  const s = res.status;
  if (s === 429) return new ProviderError("rate_limited", "SCIORA is busy. Please try again shortly.", parseRetryAfter(res.headers.get("retry-after")));
  if (s === 401 || s === 403) return new ProviderError("misconfigured", "The AI service is not configured correctly.");
  if (s === 404) return new ProviderError("misconfigured", "The configured AI model is not available.");
  if (s === 413) return new ProviderError("bad_output", "The request was too large for the AI service.");
  if (s === 498 || s >= 500) return new ProviderError("unavailable", "The AI service is temporarily unavailable.");
  return new ProviderError("bad_output", "The AI service returned an error.");
}

/** Retry-After in seconds (number or HTTP date). Defaults to 30 s; capped at 1 hour. */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (value) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.min(Math.ceil(n), 3600);
    const date = Date.parse(value);
    if (Number.isFinite(date) && date > now) return Math.min(Math.ceil((date - now) / 1000), 3600);
  }
  return 30;
}

/** gpt-oss models accept reasoning_effort low/medium/high (Groq docs); other models may reject it. */
export function supportsReasoningEffort(model: string): boolean {
  return model.startsWith("openai/gpt-oss-");
}

export interface GroqStructuredArgs<T> {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  user: string;
  /** Name sent as json_schema.name ([a-zA-Z0-9_-]). */
  schemaName: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export const MAX_GROQ_ATTEMPTS = 2;

export async function callGroqStructured<T>(client: GroqClient, timeoutMs: number, args: GroqStructuredArgs<T>): Promise<{ data: T; model: string; fallbackUsed: false }> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: toGroqStrictSchema(args.schema) } },
    max_completion_tokens: args.maxTokens,
    stream: false,
  };
  if (supportsReasoningEffort(args.model)) {
    body.reasoning_effort = args.effort;
    body.include_reasoning = false;
  }

  for (let attempt = 1; attempt <= MAX_GROQ_ATTEMPTS; attempt++) {
    const last = attempt === MAX_GROQ_ATTEMPTS;
    const res = (await client.chat(body, timeoutMs)) as any;
    const choice = Array.isArray(res?.choices) ? res.choices[0] : undefined;
    const message = choice?.message;

    if ((typeof message?.refusal === "string" && message.refusal.trim()) || choice?.finish_reason === "content_filter") {
      throw new ProviderError("refusal", "The AI declined this request.");
    }
    if (choice?.finish_reason === "length") {
      // Not retried: the identical request would almost certainly be cut off again.
      throw new ProviderError("bad_output", "The AI response was too long and was cut off.");
    }
    let parsed: unknown;
    try {
      parsed = typeof message?.content === "string" ? JSON.parse(message.content) : undefined;
    } catch {
      parsed = undefined;
    }
    const checked = parsed === undefined ? null : args.schema.safeParse(parsed);
    if (!checked?.success) {
      if (last) throw new ProviderError("bad_output", "The AI response did not match the expected format.");
      continue;
    }
    // English-only policy: clearly non-English or mixed-language output is rejected (retried once).
    if (findNonEnglishOutput(checked.data)) {
      if (last) throw new ProviderError("bad_output", "The AI response was not in English.");
      continue;
    }
    return { data: checked.data, model: typeof res?.model === "string" ? res.model : args.model, fallbackUsed: false };
  }
  throw new ProviderError("bad_output", "The AI response could not be used.");
}
