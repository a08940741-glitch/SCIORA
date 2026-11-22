import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, DEFAULT_GROQ_MODEL, loadConfig } from "../../src/config.ts";
import { createProvider } from "../../src/ai/index.ts";
import { createKnowledgeProvider } from "../../src/knowledge/index.ts";
import { createEvidenceProvider } from "../../src/evidence/service.ts";
import { AnthropicProvider } from "../../src/ai/anthropic-provider.ts";
import { AnthropicKnowledgeProvider } from "../../src/knowledge/anthropic-provider.ts";
import { AnthropicEvidenceProvider } from "../../src/evidence/provider.ts";
import { GroqProvider } from "../../src/ai/groq-provider.ts";
import { GroqKnowledgeProvider } from "../../src/knowledge/groq-provider.ts";
import { GroqEvidenceProvider } from "../../src/evidence/groq-provider.ts";
import { DemoProvider } from "../../src/ai/demo-provider.ts";
import { DemoKnowledgeProvider } from "../../src/knowledge/demo-provider.ts";
import { DemoEvidenceProvider } from "../../src/evidence/provider.ts";
import { GroqClient } from "../../src/ai/groq-client.ts";
import { fakeClient } from "../helpers/fake-client.ts";
import { FAKE_GROQ_KEY, fakeGroqFetch } from "../helpers/fake-groq.ts";

/** Factories that record calls; neither can reach the network. */
function factories() {
  const anthropicKeys: string[] = [];
  const groqKeys: string[] = [];
  const anthropic = (key: string) => {
    anthropicKeys.push(key);
    return fakeClient([]).client;
  };
  const groq = (key: string) => {
    groqKeys.push(key);
    return new GroqClient({ apiKey: key, fetch: fakeGroqFetch([]).fetchFn });
  };
  return { anthropic, groq, anthropicKeys, groqKeys };
}
function build(env: Record<string, string>) {
  const config = loadConfig(env);
  const f = factories();
  return {
    config,
    f,
    lesson: createProvider(config, f.anthropic, f.groq),
    knowledge: createKnowledgeProvider(config, f.anthropic, f.groq),
    evidence: createEvidenceProvider(config, f.anthropic, f.groq),
  };
}

// ================================================================= configuration

test("defaults: provider anthropic, Groq models default to the documented gpt-oss-120b, demo mode", () => {
  const c = loadConfig({});
  assert.equal(c.aiMode, "demo");
  assert.equal(c.aiProvider, "anthropic");
  assert.equal(DEFAULT_GROQ_MODEL, "openai/gpt-oss-120b");
  assert.deepEqual(c.groqModels, { learn: DEFAULT_GROQ_MODEL, fast: DEFAULT_GROQ_MODEL, reason: DEFAULT_GROQ_MODEL });
  assert.equal(c.groqApiKey, undefined);
  assert.equal(c.anthropicApiKey, undefined);
});

test("a Groq key alone (even with SCIORA_AI_PROVIDER=groq) does NOT enable live mode", () => {
  const c = loadConfig({ SCIORA_AI_PROVIDER: "groq", GROQ_API_KEY: FAKE_GROQ_KEY });
  assert.equal(c.aiMode, "demo");
  assert.equal(c.groqApiKey, undefined, "key is not kept in demo mode");
});

test("live + groq requires GROQ_API_KEY (error names the variable, never a value)", () => {
  assert.throws(() => loadConfig({ SCIORA_AI_MODE: "live", SCIORA_AI_PROVIDER: "groq" }), (e: unknown) => e instanceof ConfigError && /GROQ_API_KEY/.test(e.message));
  // An Anthropic key does not satisfy the Groq requirement.
  assert.throws(() => loadConfig({ SCIORA_AI_MODE: "live", SCIORA_AI_PROVIDER: "groq", ANTHROPIC_API_KEY: "test-key-not-real" }), ConfigError);
});

test("only the selected provider's key is kept in the config", () => {
  const g = loadConfig({ SCIORA_AI_MODE: "live", SCIORA_AI_PROVIDER: "groq", GROQ_API_KEY: FAKE_GROQ_KEY, ANTHROPIC_API_KEY: "test-key-not-real" });
  assert.equal(g.groqApiKey, FAKE_GROQ_KEY);
  assert.equal(g.anthropicApiKey, undefined);
  const a = loadConfig({ SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real", GROQ_API_KEY: FAKE_GROQ_KEY });
  assert.equal(a.aiProvider, "anthropic");
  assert.equal(a.anthropicApiKey, "test-key-not-real");
  assert.equal(a.groqApiKey, undefined);
});

test("existing Anthropic rule unchanged: live without a provider setting still requires ANTHROPIC_API_KEY", () => {
  assert.throws(() => loadConfig({ SCIORA_AI_MODE: "live", GROQ_API_KEY: FAKE_GROQ_KEY }), /SCIORA_AI_MODE=live requires ANTHROPIC_API_KEY/);
});

test("provider value is validated (case/whitespace tolerant); unknown providers are rejected", () => {
  assert.equal(loadConfig({ SCIORA_AI_PROVIDER: " GROQ " }).aiProvider, "groq");
  assert.equal(loadConfig({ SCIORA_AI_PROVIDER: "" }).aiProvider, "anthropic");
  for (const bad of ["openai", "gemini", "groq;rm -rf"]) {
    assert.throws(() => loadConfig({ SCIORA_AI_PROVIDER: bad }), (e: unknown) => e instanceof ConfigError && /SCIORA_AI_PROVIDER/.test(e.message) && !e.message.includes(bad));
  }
});

test("Groq model ids: owner-prefixed ids accepted; unsafe ids rejected", () => {
  const c = loadConfig({ SCIORA_GROQ_MODEL_FAST: "openai/gpt-oss-20b", SCIORA_GROQ_MODEL_REASON: "qwen/qwen3.8-27b" });
  assert.equal(c.groqModels.fast, "openai/gpt-oss-20b");
  assert.equal(c.groqModels.reason, "qwen/qwen3.8-27b");
  for (const bad of ["../etc/passwd", "a/b/c", "Model With Spaces", "x".repeat(200), "https://evil.example/m"]) {
    assert.throws(() => loadConfig({ SCIORA_GROQ_MODEL_LEARN: bad }), ConfigError, bad);
  }
});

// ================================================================= provider selection

test("selection: demo by default → demo providers, no client created for either vendor", () => {
  const { lesson, knowledge, evidence, f } = build({ GROQ_API_KEY: FAKE_GROQ_KEY, ANTHROPIC_API_KEY: "test-key-not-real" });
  assert.ok(lesson instanceof DemoProvider);
  assert.ok(knowledge instanceof DemoKnowledgeProvider);
  assert.ok(evidence instanceof DemoEvidenceProvider);
  assert.deepEqual([f.anthropicKeys.length, f.groqKeys.length], [0, 0]);
});

test("selection: live + groq → Groq providers for all features with Groq models; Anthropic factory never called", () => {
  const { lesson, knowledge, evidence, f } = build({
    SCIORA_AI_MODE: "live",
    SCIORA_AI_PROVIDER: "groq",
    GROQ_API_KEY: FAKE_GROQ_KEY,
    SCIORA_GROQ_MODEL_FAST: "openai/gpt-oss-20b",
  });
  assert.ok(lesson instanceof GroqProvider);
  assert.ok(knowledge instanceof GroqKnowledgeProvider);
  assert.ok(evidence instanceof GroqEvidenceProvider);
  assert.deepEqual(lesson.models, { learn: DEFAULT_GROQ_MODEL, fast: "openai/gpt-oss-20b" });
  assert.deepEqual(knowledge.models, { learn: DEFAULT_GROQ_MODEL, fast: "openai/gpt-oss-20b" });
  assert.equal(evidence.model, DEFAULT_GROQ_MODEL);
  assert.equal(lesson.simulated, false);
  assert.deepEqual(f.groqKeys, [FAKE_GROQ_KEY, FAKE_GROQ_KEY, FAKE_GROQ_KEY]);
  assert.equal(f.anthropicKeys.length, 0);
});

test("selection: live + anthropic (default) → Anthropic providers exactly as before; Groq factory never called", () => {
  const { lesson, knowledge, evidence, f } = build({ SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real", GROQ_API_KEY: FAKE_GROQ_KEY });
  assert.ok(lesson instanceof AnthropicProvider);
  assert.ok(knowledge instanceof AnthropicKnowledgeProvider);
  assert.ok(evidence instanceof AnthropicEvidenceProvider);
  assert.deepEqual(lesson.models, { learn: "claude-sonnet-5-5", fast: "claude-haiku-5-5" });
  assert.equal(evidence.model, "claude-opus-5-5");
  assert.equal(f.groqKeys.length, 0);
  assert.equal(f.anthropicKeys.length, 3);
});

test("isolation: even a hand-built config holding BOTH keys follows SCIORA_AI_PROVIDER exactly", () => {
  const base = loadConfig({ SCIORA_AI_MODE: "live", ANTHROPIC_API_KEY: "test-key-not-real" });
  const both = { ...base, anthropicApiKey: "test-key-not-real", groqApiKey: FAKE_GROQ_KEY };

  const g = factories();
  const groqCfg = { ...both, aiProvider: "groq" as const };
  assert.ok(createProvider(groqCfg, g.anthropic, g.groq) instanceof GroqProvider);
  assert.ok(createKnowledgeProvider(groqCfg, g.anthropic, g.groq) instanceof GroqKnowledgeProvider);
  assert.ok(createEvidenceProvider(groqCfg, g.anthropic, g.groq) instanceof GroqEvidenceProvider);
  assert.equal(g.anthropicKeys.length, 0, "Anthropic never used when Groq is selected");

  const a = factories();
  const anthropicCfg = { ...both, aiProvider: "anthropic" as const };
  assert.ok(createProvider(anthropicCfg, a.anthropic, a.groq) instanceof AnthropicProvider);
  assert.ok(createKnowledgeProvider(anthropicCfg, a.anthropic, a.groq) instanceof AnthropicKnowledgeProvider);
  assert.ok(createEvidenceProvider(anthropicCfg, a.anthropic, a.groq) instanceof AnthropicEvidenceProvider);
  assert.equal(a.groqKeys.length, 0, "Groq never used when Anthropic is selected");
});

test("isolation: selected provider without its own key → demo (never the other vendor)", () => {
  const base = loadConfig({});
  const f = factories();
  const groqNoKey = { ...base, aiMode: "live" as const, aiProvider: "groq" as const, anthropicApiKey: "test-key-not-real", groqApiKey: undefined };
  assert.ok(createProvider(groqNoKey, f.anthropic, f.groq) instanceof DemoProvider);
  const anthropicNoKey = { ...base, aiMode: "live" as const, aiProvider: "anthropic" as const, anthropicApiKey: undefined, groqApiKey: FAKE_GROQ_KEY };
  assert.ok(createEvidenceProvider(anthropicNoKey, f.anthropic, f.groq) instanceof DemoEvidenceProvider);
  assert.deepEqual([f.anthropicKeys.length, f.groqKeys.length], [0, 0]);
});

test("GROQ_API_KEY shape is validated in Groq live mode; the error never echoes the value", () => {
  const live = { SCIORA_AI_MODE: "live", SCIORA_AI_PROVIDER: "groq" };
  for (const bad of ["short-key", "has a space inside the key 0000000", "line\nbreak-inside-key-000000000", "non-ascii-key-éééééééééééééé", "x".repeat(300)]) {
    assert.throws(
      () => loadConfig({ ...live, GROQ_API_KEY: bad }),
      (e: unknown) => e instanceof ConfigError && /GROQ_API_KEY/.test(e.message) && !e.message.includes(bad.trim().slice(0, 8)),
      JSON.stringify(bad.slice(0, 12)),
    );
  }
  // Surrounding whitespace from copy-paste is trimmed, then accepted.
  assert.equal(loadConfig({ ...live, GROQ_API_KEY: `  ${FAKE_GROQ_KEY}\n` }).groqApiKey, FAKE_GROQ_KEY);
  // Demo mode never inspects or keeps a Groq key.
  assert.equal(loadConfig({ SCIORA_AI_PROVIDER: "groq", GROQ_API_KEY: "short" }).groqApiKey, undefined);
});
