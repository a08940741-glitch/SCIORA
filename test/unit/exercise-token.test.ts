import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { ExerciseTokenCodec, TokenError, keyIdFor } from "../../src/domain/exercise-token.ts";
import { sampleLesson, SECRET_MARKERS } from "../helpers/sample-lesson.ts";

const SECRET = Buffer.alloc(32, 1);
const OTHER = Buffer.alloc(32, 2);

function makeCodec(now = () => 1_800_000_000_000, secrets = [SECRET]) {
  return new ExerciseTokenCodec({ secrets, ttlSeconds: 7200, now });
}
function sealSample(codec = makeCodec()) {
  return codec.seal({ topic: "t", subject: "math", level: "school", language: "en", exercises: sampleLesson().exercises });
}
function expectTokenError(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof TokenError && e.code === code, `expected TokenError(${code})`);
}
function flipChar(s: string, i: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const c = s[i]!;
  const r = alphabet[(alphabet.indexOf(c) + 1) % alphabet.length]!;
  return s.slice(0, i) + r + s.slice(i + 1);
}

test("token-roundtrip: seal then open returns the same payload", () => {
  const codec = makeCodec();
  const { token, tid, exp } = sealSample(codec);
  const p = codec.open(token);
  assert.equal(p.tid, tid);
  assert.equal(p.exp, exp);
  assert.deepEqual(p.exercises, sampleLesson().exercises);
});

test("token-is-opaque: no answer or rubric text in any decoded part of the token", () => {
  const { token } = sealSample();
  const decodedParts = token.split(".").map((p) => {
    try {
      return Buffer.from(p, "base64url").toString("utf8");
    } catch {
      return "";
    }
  });
  const haystack = token + "\n" + decodedParts.join("\n");
  for (const m of [...SECRET_MARKERS, "correctChoiceId", "rubric", "modelAnswer"]) {
    assert.equal(haystack.includes(m), false, `token reveals ${m}`);
  }
});

test("token-is-opaque: two tokens for the same content differ (fresh IV and tid)", () => {
  const codec = makeCodec();
  const a = sealSample(codec);
  const b = sealSample(codec);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.tid, b.tid);
  assert.notEqual(a.token.split(".")[2], b.token.split(".")[2], "IVs must differ");
});

test("forged-token-rejected: token built with a different key", () => {
  const forger = makeCodec(undefined, [OTHER]);
  const { token } = sealSample(forger);
  // Present it with the real kid so it reaches decryption.
  const parts = token.split(".");
  parts[1] = keyIdFor(SECRET);
  expectTokenError(() => makeCodec().open(parts.join(".")), "invalid");
});

test("forged-token-rejected: hand-made token with plaintext JSON and random tag", () => {
  const fakePayload = Buffer.from(JSON.stringify({ v: 1, exercises: [] })).toString("base64url");
  const forged = ["v1", keyIdFor(SECRET), randomBytes(12).toString("base64url"), fakePayload, randomBytes(16).toString("base64url")].join(".");
  expectTokenError(() => makeCodec().open(forged), "invalid");
});

test("tampered-ciphertext-rejected: one character changed in IV, ciphertext, or tag", () => {
  const codec = makeCodec();
  const { token } = sealSample(codec);
  for (const partIndex of [2, 3, 4]) {
    const parts = token.split(".");
    parts[partIndex] = flipChar(parts[partIndex]!, 0);
    assert.throws(() => codec.open(parts.join(".")), TokenError, `part ${partIndex}`);
  }
});

test("wrong-aad-or-kid-rejected: unknown kid", () => {
  const { token } = sealSample();
  const parts = token.split(".");
  parts[1] = "deadbeef";
  expectTokenError(() => makeCodec().open(parts.join(".")), "invalid");
});

test("wrong-aad-or-kid-rejected: ciphertext sealed with correct key but different AAD purpose", async () => {
  // Derive the real key exactly as the codec does, but encrypt with a different AAD purpose label.
  const { hkdfSync } = await import("node:crypto");
  const kid = keyIdFor(SECRET);
  const key = Buffer.from(hkdfSync("sha256", SECRET, Buffer.from("sciora-exercise-token-salt-v1"), `sciora:exercise:v1:aes-256-gcm:${kid}`, 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from("sciora:session:v1|" + kid)); // different purpose
  const pt = Buffer.from(JSON.stringify({ v: 1 }));
  const ct = Buffer.concat([c.update(pt), c.final()]);
  const tok = ["v1", kid, iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
  expectTokenError(() => makeCodec().open(tok), "invalid");
});

test("malformed-token-rejected: wrong shapes never crash", () => {
  const codec = makeCodec();
  const cases = ["", "abc", "v1.a.b.c", "v2.a.b.c.d", "v1.kid.!!!.@@@.###", "v1." + "x".repeat(25000), "v1.kid..ct.tag"];
  for (const c of cases) assert.throws(() => codec.open(c), TokenError, JSON.stringify(c.slice(0, 30)));
  assert.throws(() => codec.open(undefined as unknown as string), TokenError);
});

test("malformed-token-rejected: wrong IV or tag length", () => {
  const codec = makeCodec();
  const { token } = sealSample(codec);
  const parts = token.split(".");
  const shortIv = [...parts];
  shortIv[2] = randomBytes(8).toString("base64url");
  expectTokenError(() => codec.open(shortIv.join(".")), "malformed");
  const shortTag = [...parts];
  shortTag[4] = randomBytes(8).toString("base64url");
  expectTokenError(() => codec.open(shortTag.join(".")), "malformed");
});

test("expired-token-rejected: exp + 61 s is rejected with code expired (HTTP 410)", () => {
  let now = 1_800_000_000_000;
  const codec = makeCodec(() => now);
  const { token, exp } = sealSample(codec);
  now = (exp + 60) * 1000; // still inside skew
  assert.doesNotThrow(() => codec.open(token));
  now = (exp + 61) * 1000;
  try {
    codec.open(token);
    assert.fail("should be expired");
  } catch (e) {
    assert.ok(e instanceof TokenError);
    assert.equal(e.code, "expired");
    assert.equal(e.httpStatus, 410);
  }
});

test("future-iat-rejected: token issued beyond clock skew is rejected", () => {
  let now = 1_800_000_000_000;
  const codec = makeCodec(() => now);
  const { token } = sealSample(codec);
  now -= 61_000; // verifier clock behind issuer by 61 s
  expectTokenError(() => codec.open(token), "not_yet_valid");
});

test("key rotation: old key still opens, new tokens use the first key", () => {
  const oldCodec = makeCodec(undefined, [OTHER]);
  const { token } = sealSample(oldCodec);
  const rotated = makeCodec(undefined, [SECRET, OTHER]);
  assert.doesNotThrow(() => rotated.open(token));
  const fresh = sealSample(rotated);
  assert.equal(fresh.token.split(".")[1], keyIdFor(SECRET));
});

test("short secrets are refused", () => {
  assert.throws(() => new ExerciseTokenCodec({ secrets: [Buffer.alloc(16)], ttlSeconds: 60 }));
});

test("error httpStatus is 400 for non-expiry failures (no detail leaked)", () => {
  assert.equal(new TokenError("invalid").httpStatus, 400);
  assert.equal(new TokenError("malformed").httpStatus, 400);
  assert.equal(new TokenError("not_yet_valid").httpStatus, 400);
});
