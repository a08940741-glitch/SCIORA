import { z } from "zod";
import type { Config } from "../config.ts";
import type { RetrievedSource } from "./schemas.ts";
import { NoopRetriever, type SourceRetriever } from "./retriever.ts";

/**
 * Wikipedia retriever (free public MediaWiki Action API, no key).
 *
 * Safety & respectful use:
 *  - Fixed hosts only ({ar,fr,en}.wikipedia.org); user text never controls the URL (no SSRF).
 *  - Descriptive, configurable User-Agent; `maxlag=5`; minimum interval between requests;
 *    in-memory cache (TTL); at most `maxRetries` retries with exponential backoff that honours
 *    Retry-After (capped); every wait is cancelled when the caller's AbortSignal fires.
 *  - Responses are UNTRUSTED: schema-validated, size-capped, URLs must be https on the
 *    expected wiki host, disambiguation pages skipped. Results are sanitized again by
 *    sanitizeSources() before use.
 *  - No fabricated metadata: Wikipedia articles have no publication date, so publishedAt is
 *    null; lastModified is the real timestamp of the latest revision reported by the API.
 */

export const WIKIS = ["ar", "fr", "en"] as const;
export type Wiki = (typeof WIKIS)[number];

const MAX_BODY_CHARS = 1_000_000;
const MAX_EXCERPT = 1500;
const ARABIC = /[؀-ۿ]/;

const ApiResponse = z.object({
  error: z.object({ code: z.string(), info: z.string().optional() }).optional(),
  query: z
    .object({
      pages: z
        .array(
          z.object({
            pageid: z.number().optional(),
            ns: z.number(),
            title: z.string(),
            index: z.number().optional(),
            missing: z.boolean().optional(),
            fullurl: z.string().optional(),
            extract: z.string().optional(),
            pageprops: z.record(z.string(), z.unknown()).optional(),
            revisions: z.array(z.object({ timestamp: z.string() })).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/** Common question words removed from the search text (Darija, MSA, French, English, Arabizi). */
const QUESTION_WORDS = [
  "شنو هو", "شنو هي", "شنو هما", "اشنو هو", "شنو", "اشنو", "علاش", "كيفاش", "واش", "شرح ليا", "شرح",
  "ما هو", "ما هي", "ما هما", "ماذا", "لماذا", "كيف", "هل", "عرف",
  "qu'est-ce que", "qu'est ce que", "c'est quoi", "explique", "pourquoi", "comment",
  "what is", "what are", "how does", "how do", "why", "explain",
  "chno howa", "chno hiya", "chnou", "chno", "kifach", "3lach", "wach",
];

export function cleanSearchQuery(raw: string): string {
  let q = ` ${raw.toLowerCase().replace(/[?؟!.,،:;"«»()]/g, " ")} `;
  for (const w of QUESTION_WORDS) q = q.split(` ${w} `).join(" ");
  q = q.replace(/\s+/g, " ").trim().slice(0, 200);
  return q || raw.trim().slice(0, 200);
}

/** Which wikis to try, in order (max 2), based on the query's script and the answer language. */
export function chooseWikis(query: string, language: string): Wiki[] {
  if (ARABIC.test(query)) return language === "fr" ? ["ar", "fr"] : ["ar", "en"];
  if (language === "fr") return ["fr", "en"];
  return ["en", "fr"];
}

export class WikipediaHttpError extends Error {
  constructor(public readonly status: number) {
    super(`wikipedia http ${status}`);
  }
}

export interface WikipediaRetrieverOptions {
  userAgent: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  cacheMax?: number;
  minIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxRetryAfterMs?: number;
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

/** Sleep that rejects immediately when the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class WikipediaRetriever implements SourceRetriever {
  readonly name = "wikipedia";
  readonly enabled = true;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly ua: string;
  private readonly cacheTtl: number;
  private readonly cacheMax: number;
  private readonly minInterval: number;
  private readonly maxRetries: number;
  private readonly baseBackoff: number;
  private readonly maxRetryAfter: number;
  private readonly cache = new Map<string, { at: number; value: RetrievedSource[] }>();
  private nextSlot = 0;
  /** Requests actually sent (for tests / diagnostics). */
  requestCount = 0;

  constructor(opts: WikipediaRetrieverOptions) {
    this.ua = opts.userAgent;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
    this.cacheTtl = opts.cacheTtlMs ?? 60 * 60 * 1000;
    this.cacheMax = opts.cacheMax ?? 200;
    this.minInterval = opts.minIntervalMs ?? 250;
    this.maxRetries = opts.maxRetries ?? 2;
    this.baseBackoff = opts.baseBackoffMs ?? 400;
    this.maxRetryAfter = opts.maxRetryAfterMs ?? 5000;
  }

  async search(query: string, opts: { language: string; limit: number; signal: AbortSignal }): Promise<RetrievedSource[]> {
    const q = cleanSearchQuery(query);
    const limit = Math.max(1, Math.min(5, opts.limit));
    let lastError: unknown = null;
    for (const wiki of chooseWikis(query, opts.language)) {
      try {
        const results = await this.searchWiki(wiki, q, limit, opts.signal);
        if (results.length) return results;
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || opts.signal.aborted) throw err; // timeout: stop immediately
        lastError = err; // e.g. this wiki is rate-limiting us → try the next wiki
      }
    }
    if (lastError) throw lastError; // every wiki failed → caller reports retrieval "failed"
    return [];
  }

  buildUrl(wiki: Wiki, q: string, limit: number): string {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: q,
      gsrlimit: String(limit),
      gsrnamespace: "0",
      prop: "extracts|info|revisions|pageprops",
      exintro: "1",
      explaintext: "1",
      exlimit: String(limit),
      inprop: "url",
      rvprop: "timestamp",
      ppprop: "disambiguation",
      maxlag: "5",
      utf8: "1",
    });
    return `https://${wiki}.wikipedia.org/w/api.php?${params.toString()}`;
  }

  private async searchWiki(wiki: Wiki, q: string, limit: number, signal: AbortSignal): Promise<RetrievedSource[]> {
    const key = `${wiki}|${limit}|${q}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.cacheTtl) return hit.value;

    const body = await this.fetchWithRetry(this.buildUrl(wiki, q, limit), signal);
    const parsed = ApiResponse.safeParse(body);
    if (!parsed.success) throw new Error("wikipedia: unexpected response shape");
    if (parsed.data.error) throw new Error(`wikipedia api error: ${parsed.data.error.code}`);

    const host = `${wiki}.wikipedia.org`;
    const results: RetrievedSource[] = (parsed.data.query?.pages ?? [])
      .filter((p) => p.ns === 0 && !p.missing && !(p.pageprops && "disambiguation" in p.pageprops))
      .filter((p) => {
        try {
          const u = new URL(p.fullurl ?? "");
          return u.protocol === "https:" && u.hostname === host;
        } catch {
          return false;
        }
      })
      .filter((p) => (p.extract ?? "").trim().length > 0)
      .sort((a, b) => (a.index ?? 999) - (b.index ?? 999))
      .slice(0, limit)
      .map((p) => ({
        title: p.title.slice(0, 300),
        url: p.fullurl!,
        publisher: `Wikipedia (${wiki})`,
        publishedAt: null, // Wikipedia articles have no publication date — never invented.
        lastModified: p.revisions?.[0]?.timestamp?.slice(0, 40) ?? null,
        excerpt: (p.extract ?? "").trim().slice(0, MAX_EXCERPT),
        language: wiki,
      }));

    if (this.cache.size >= this.cacheMax) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.now(), value: results });
    return results;
  }

  /** Waits for the next request slot (minimum interval between requests). */
  private async throttle(signal: AbortSignal): Promise<void> {
    const now = this.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minInterval;
    if (wait > 0) await sleep(wait, signal);
  }

  private async fetchWithRetry(url: string, signal: AbortSignal): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) throw abortError();
      await this.throttle(signal);
      let res: Response;
      try {
        this.requestCount++;
        res = await this.fetchFn(url, {
          headers: { "User-Agent": this.ua, "Api-User-Agent": this.ua, Accept: "application/json" },
          signal,
          redirect: "error",
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || signal.aborted) throw abortError();
        lastError = err; // network error → retry with backoff
        if (attempt < this.maxRetries) await sleep(this.baseBackoff * 2 ** attempt, signal);
        continue;
      }
      const retryable = res.status === 429 || res.status === 503 || res.status === 502 || res.status === 504;
      if (retryable) {
        lastError = new WikipediaHttpError(res.status);
        if (attempt < this.maxRetries) {
          const ra = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, this.maxRetryAfter) : this.baseBackoff * 2 ** attempt;
          await sleep(waitMs, signal);
        }
        continue;
      }
      if (!res.ok) throw new WikipediaHttpError(res.status);
      const text = await res.text();
      if (text.length > MAX_BODY_CHARS) throw new Error("wikipedia: response too large");
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("wikipedia: invalid JSON");
      }
      if (json?.error?.code === "maxlag" && attempt < this.maxRetries) {
        lastError = new Error("wikipedia: maxlag");
        await sleep(this.baseBackoff * 2 ** attempt, signal);
        continue;
      }
      return json;
    }
    throw lastError instanceof Error ? lastError : new Error("wikipedia: request failed");
  }
}

export { DEFAULT_WIKI_USER_AGENT } from "./wikipedia-agent.ts";

/** Retriever from configuration: "wikipedia" (default) or "none". */
export function createRetriever(config: Pick<Config, "retriever" | "wikiUserAgent">, fetchFn?: typeof fetch): SourceRetriever {
  if (config.retriever === "wikipedia") return new WikipediaRetriever({ userAgent: config.wikiUserAgent, fetchFn });
  return new NoopRetriever();
}
