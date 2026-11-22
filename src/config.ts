import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DEFAULT_WIKI_USER_AGENT } from "./knowledge/wikipedia-agent.ts";

/**
 * SCIORA configuration.
 *
 * Safety rules enforced here:
 *  - Live AI is used ONLY when SCIORA_AI_MODE=live AND the selected provider's API key is
 *    present. A key on its own never enables live mode.
 *  - SCIORA_AI_PROVIDER selects the live provider: "anthropic" (default) or "groq".
 *    Only the selected provider's key is kept; the other is never read into the config.
 *  - In production the exercise-token secret is mandatory (>= 32 bytes).
 *    In development a random ephemeral secret is generated (tokens die on restart).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type AiMode = "demo" | "live";
export type AiProviderName = "anthropic" | "groq";

export interface ModelConfig {
  /** Lessons: understanding, explanations, examples, exercises. */
  learn: string;
  /** Simpler tasks: rubric-based grading of written answers. */
  fast: string;
  /** Reserved for Phase 2 tasks needing stronger reasoning. Unused in Phase 1. */
  reason: string;
}

export interface Config {
  nodeEnv: "development" | "production" | "test";
  port: number;
  host: string;
  aiMode: AiMode;
  /** Live provider (used only when aiMode === "live"). */
  aiProvider: AiProviderName;
  /** Only set when aiMode === "live" and aiProvider === "anthropic". Never logged, never sent to the browser. */
  anthropicApiKey: string | undefined;
  /** Only set when aiMode === "live" and aiProvider === "groq". Never logged, never sent to the browser. */
  groqApiKey: string | undefined;
  /** Anthropic model routing. */
  models: ModelConfig;
  /** Groq model routing (same three tiers). */
  groqModels: ModelConfig;
  gradeEscalation: boolean;
  tokenSecret: Buffer;
  tokenSecretEphemeral: boolean;
  tokenTtlSeconds: number;
  replay: { maxEntries: number; highWater: number };
  rateLimitPerMinute: number;
  /** 0 = no daily limit. */
  dailyLimit: number;
  allowLiveTests: boolean;
  /** Source retriever: "wikipedia" (free public MediaWiki API) or "none". */
  retriever: "wikipedia" | "none";
  /** User-Agent sent to Wikipedia (Wikimedia asks for contact information). */
  wikiUserAgent: string;
}

const MIN_SECRET_BYTES = 32;

const intFrom = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
  PORT: intFrom(8787, 1, 65535),
  HOST: z.string().optional().default("127.0.0.1"),
  SCIORA_AI_MODE: z
    .string()
    .optional()
    .transform((v) => (v ?? "demo").trim().toLowerCase())
    .pipe(z.enum(["demo", "live"])),
  SCIORA_AI_PROVIDER: z
    .string()
    .optional()
    .transform((v) => (v ?? "anthropic").trim().toLowerCase() || "anthropic")
    .pipe(z.enum(["anthropic", "groq"])),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  SCIORA_GROQ_MODEL_LEARN: z.string().optional(),
  SCIORA_GROQ_MODEL_FAST: z.string().optional(),
  SCIORA_GROQ_MODEL_REASON: z.string().optional(),
  SCIORA_MODEL_LEARN: z.string().optional(),
  SCIORA_MODEL_FAST: z.string().optional(),
  SCIORA_MODEL_REASON: z.string().optional(),
  SCIORA_GRADE_ESCALATION: z.string().optional(),
  SCIORA_TOKEN_SECRET: z.string().optional(),
  SCIORA_TOKEN_TTL_SECONDS: intFrom(7200, 60, 86400),
  SCIORA_REPLAY_MAX_ENTRIES: intFrom(20000, 1, 1_000_000),
  SCIORA_REPLAY_HIGH_WATER: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? 0.9 : Number(v)))
    .pipe(z.number().gt(0).max(1)),
  SCIORA_RATE_LIMIT_PER_MINUTE: intFrom(30, 1, 10000),
  SCIORA_DAILY_LIMIT: intFrom(0, 0, 10_000_000),
  SCIORA_ALLOW_LIVE_TESTS: z.string().optional(),
  SCIORA_RETRIEVER: z
    .string()
    .optional()
    .transform((v) => (v ?? "wikipedia").trim().toLowerCase() || "wikipedia")
    .pipe(z.enum(["wikipedia", "none"])),
  SCIORA_WIKI_USER_AGENT: z.string().max(300).optional(),
});

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,63}$/;
/** Plausible API key shape: visible ASCII only, no whitespace. Provider-specific prefixes are not assumed. */
const API_KEY_SHAPE = /^[\x21-\x7E]{20,256}$/;

/** Groq model ids may carry an owner prefix, e.g. "openai/gpt-oss-120b". */
const GROQ_MODEL_ID = /^[a-z0-9][a-z0-9._\-]{0,63}(\/[a-z0-9][a-z0-9._\-]{0,63})?$/;

/**
 * Default Groq model. Chosen because Groq's documentation (checked 2026-11-21) lists it as a
 * production model that supports strict structured outputs, with no deprecation notice.
 * Re-check https://console.groq.com/docs/models and /docs/deprecations before relying on it.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

function pickModel(value: string | undefined, fallback: string, name: string, pattern = MODEL_ID): string {
  const v = value?.trim();
  if (!v) return fallback;
  if (!pattern.test(v)) throw new ConfigError(`${name} is not a valid model id`);
  return v;
}

function isOn(v: string | undefined): boolean {
  return ["1", "on", "true", "yes"].includes((v ?? "").trim().toLowerCase());
}

/** Accepts base64 or hex. Returns undefined if empty. */
export function decodeSecret(raw: string | undefined): Buffer | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const buf = /^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0 ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  return buf;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new ConfigError(`Invalid configuration for: ${names}`);
  }
  const e = parsed.data;

  const live = e.SCIORA_AI_MODE === "live";
  const key = e.ANTHROPIC_API_KEY?.trim() || undefined;
  const groqKey = e.GROQ_API_KEY?.trim() || undefined;
  if (live && e.SCIORA_AI_PROVIDER === "anthropic" && !key) {
    throw new ConfigError("SCIORA_AI_MODE=live requires ANTHROPIC_API_KEY");
  }
  if (live && e.SCIORA_AI_PROVIDER === "groq" && !groqKey) {
    throw new ConfigError("SCIORA_AI_MODE=live with SCIORA_AI_PROVIDER=groq requires GROQ_API_KEY");
  }
  // Shape check only (never the value in the message): a key with spaces, line breaks or
  // non-ASCII characters would otherwise fail later as a confusing network error.
  if (live && e.SCIORA_AI_PROVIDER === "groq" && groqKey && !API_KEY_SHAPE.test(groqKey)) {
    throw new ConfigError("GROQ_API_KEY does not look like an API key (expected 20–256 visible ASCII characters, no spaces)");
  }

  let tokenSecret = decodeSecret(e.SCIORA_TOKEN_SECRET);
  let tokenSecretEphemeral = false;
  if (tokenSecret && tokenSecret.length < MIN_SECRET_BYTES) {
    throw new ConfigError(`SCIORA_TOKEN_SECRET must decode to at least ${MIN_SECRET_BYTES} bytes`);
  }
  if (!tokenSecret) {
    if (e.NODE_ENV === "production") {
      throw new ConfigError("SCIORA_TOKEN_SECRET is required in production");
    }
    tokenSecret = randomBytes(MIN_SECRET_BYTES);
    tokenSecretEphemeral = true;
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    aiMode: e.SCIORA_AI_MODE,
    aiProvider: e.SCIORA_AI_PROVIDER,
    anthropicApiKey: live && e.SCIORA_AI_PROVIDER === "anthropic" ? key : undefined,
    groqApiKey: live && e.SCIORA_AI_PROVIDER === "groq" ? groqKey : undefined,
    models: {
      learn: pickModel(e.SCIORA_MODEL_LEARN, "claude-sonnet-5-5", "SCIORA_MODEL_LEARN"),
      fast: pickModel(e.SCIORA_MODEL_FAST, "claude-haiku-5-5", "SCIORA_MODEL_FAST"),
      reason: pickModel(e.SCIORA_MODEL_REASON, "claude-opus-5-5", "SCIORA_MODEL_REASON"),
    },
    groqModels: {
      learn: pickModel(e.SCIORA_GROQ_MODEL_LEARN, DEFAULT_GROQ_MODEL, "SCIORA_GROQ_MODEL_LEARN", GROQ_MODEL_ID),
      fast: pickModel(e.SCIORA_GROQ_MODEL_FAST, DEFAULT_GROQ_MODEL, "SCIORA_GROQ_MODEL_FAST", GROQ_MODEL_ID),
      reason: pickModel(e.SCIORA_GROQ_MODEL_REASON, DEFAULT_GROQ_MODEL, "SCIORA_GROQ_MODEL_REASON", GROQ_MODEL_ID),
    },
    gradeEscalation: isOn(e.SCIORA_GRADE_ESCALATION),
    tokenSecret,
    tokenSecretEphemeral,
    tokenTtlSeconds: e.SCIORA_TOKEN_TTL_SECONDS,
    replay: { maxEntries: e.SCIORA_REPLAY_MAX_ENTRIES, highWater: e.SCIORA_REPLAY_HIGH_WATER },
    rateLimitPerMinute: e.SCIORA_RATE_LIMIT_PER_MINUTE,
    dailyLimit: e.SCIORA_DAILY_LIMIT,
    allowLiveTests: isOn(e.SCIORA_ALLOW_LIVE_TESTS),
    retriever: e.SCIORA_RETRIEVER,
    wikiUserAgent: e.SCIORA_WIKI_USER_AGENT?.trim() || DEFAULT_WIKI_USER_AGENT,
  };
}
