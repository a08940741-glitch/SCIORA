import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { Language, Level, SealedExercise, Subject } from "./schemas.ts";

/**
 * Encrypted exercise tokens (AES-256-GCM).
 *
 * Format:  v1.<kid>.<iv>.<ciphertext>.<tag>     (base64url parts)
 *
 *  - Confidentiality: answer keys / rubrics are encrypted; the browser sees only random-looking bytes.
 *  - Integrity: the GCM auth tag makes any modification or forgery fail to decrypt.
 *  - Purpose binding: AAD "sciora:exercise:v1|<kid>" — a token made for another purpose/key fails.
 *  - Key separation: the AES key is derived from SCIORA_TOKEN_SECRET with HKDF-SHA256.
 *  - Freshness: every token has a random 96-bit IV and a random 128-bit token id (tid).
 *  - Expiry: exp/iat are inside the ciphertext and are checked after decryption.
 */

export const TOKEN_VERSION = "v1";
const AAD_PREFIX = "sciora:exercise:v1|";
const HKDF_SALT = Buffer.from("sciora-exercise-token-salt-v1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_CHARS = 24000;
const MAX_PAYLOAD_BYTES = 16000;
export const CLOCK_SKEW_SECONDS = 60;

export const TokenPayload = z.strictObject({
  v: z.literal(1),
  tid: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  iat: z.number().int(),
  exp: z.number().int(),
  topic: z.string().max(120),
  subject: Subject,
  level: Level,
  language: Language,
  exercises: z.array(SealedExercise).min(1).max(4),
});
export type TokenPayload = z.infer<typeof TokenPayload>;

export type TokenErrorCode = "malformed" | "invalid" | "expired" | "not_yet_valid" | "too_large";

export class TokenError extends Error {
  constructor(public readonly code: TokenErrorCode) {
    super(`exercise token ${code}`);
    this.name = "TokenError";
  }
  /** 410 for expired, 400 otherwise (no detail about why decryption failed). */
  get httpStatus(): number {
    return this.code === "expired" ? 410 : 400;
  }
}

interface KeyEntry {
  kid: string;
  key: Buffer;
}

function deriveKey(secret: Buffer, kid: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, `sciora:exercise:v1:aes-256-gcm:${kid}`, 32));
}

/** Key id = first 8 hex chars of SHA-256(secret). Not secret; lets us rotate keys later. */
export function keyIdFor(secret: Buffer): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

const b64u = (b: Buffer) => b.toString("base64url");
const B64U = /^[A-Za-z0-9_-]+$/;

export interface TokenCodecOptions {
  /** First secret is used to seal; all are accepted to open (rotation). */
  secrets: Buffer[];
  ttlSeconds: number;
  now?: () => number; // ms
}

export class ExerciseTokenCodec {
  private readonly keys: KeyEntry[];
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(opts: TokenCodecOptions) {
    if (opts.secrets.length === 0) throw new Error("at least one secret required");
    this.keys = opts.secrets.map((s) => {
      if (s.length < 32) throw new Error("token secret must be >= 32 bytes");
      const kid = keyIdFor(s);
      return { kid, key: deriveKey(s, kid) };
    });
    this.ttl = opts.ttlSeconds;
    this.now = opts.now ?? Date.now;
  }

  private nowSec(): number {
    return Math.floor(this.now() / 1000);
  }

  /** Seals answer keys. Returns the opaque token plus its id and expiry. */
  seal(input: Omit<TokenPayload, "v" | "tid" | "iat" | "exp">): { token: string; tid: string; exp: number } {
    const iat = this.nowSec();
    const payload: TokenPayload = TokenPayload.parse({
      v: 1,
      tid: b64u(randomBytes(16)),
      iat,
      exp: iat + this.ttl,
      ...input,
    });
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    if (plaintext.length > MAX_PAYLOAD_BYTES) throw new TokenError("too_large");

    const { kid, key } = this.keys[0]!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(AAD_PREFIX + kid, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const token = [TOKEN_VERSION, kid, b64u(iv), b64u(ct), b64u(tag)].join(".");
    return { token, tid: payload.tid, exp: payload.exp };
  }

  /** Opens and validates a token. Throws TokenError on any problem. */
  open(token: string): TokenPayload {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
      throw new TokenError("malformed");
    }
    const parts = token.split(".");
    if (parts.length !== 5) throw new TokenError("malformed");
    const [ver, kid, ivS, ctS, tagS] = parts as [string, string, string, string, string];
    if (ver !== TOKEN_VERSION) throw new TokenError("malformed");
    if (![ivS, ctS, tagS].every((p) => B64U.test(p))) throw new TokenError("malformed");

    const entry = this.keys.find((k) => k.kid === kid);
    if (!entry) throw new TokenError("invalid");

    const iv = Buffer.from(ivS, "base64url");
    const ct = Buffer.from(ctS, "base64url");
    const tag = Buffer.from(tagS, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length === 0) throw new TokenError("malformed");

    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv("aes-256-gcm", entry.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(AAD_PREFIX + kid, "utf8"));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    } catch {
      throw new TokenError("invalid");
    }

    let json: unknown;
    try {
      json = JSON.parse(plaintext.toString("utf8"));
    } catch {
      throw new TokenError("invalid");
    }
    const parsed = TokenPayload.safeParse(json);
    if (!parsed.success) throw new TokenError("invalid");
    const p = parsed.data;

    const now = this.nowSec();
    if (p.iat > now + CLOCK_SKEW_SECONDS) throw new TokenError("not_yet_valid");
    if (p.exp <= p.iat) throw new TokenError("invalid");
    if (now > p.exp + CLOCK_SKEW_SECONDS) throw new TokenError("expired");
    return p;
  }
}
