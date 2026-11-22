import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.ts";
import { AnthropicProvider, type MessagesClient } from "./anthropic-provider.ts";
import { DemoProvider } from "./demo-provider.ts";
import { GroqClient } from "./groq-client.ts";
import { GroqProvider } from "./groq-provider.ts";
import type { AIProvider } from "./provider.ts";

export type ClientFactory = (apiKey: string) => MessagesClient;
export type GroqClientFactory = (apiKey: string) => GroqClient;

/** Creates the real Groq client (built-in fetch). Only ever called in live mode with SCIORA_AI_PROVIDER=groq. */
export const defaultGroqClientFactory: GroqClientFactory = (apiKey) => new GroqClient({ apiKey });

/** Creates the real SDK client. Only ever called in live mode. */
export const defaultClientFactory: ClientFactory = (apiKey) =>
  new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 }) as unknown as MessagesClient;

/**
 * Chooses the provider. Live AI ONLY when config.aiMode === "live" (which itself requires
 * the selected provider's key; the config holds only that one key). In every other case the
 * DemoProvider is used and no client is created. A live failure is never replaced by demo content.
 */
export function createProvider(
  config: Config,
  clientFactory: ClientFactory = defaultClientFactory,
  groqClientFactory: GroqClientFactory = defaultGroqClientFactory,
): AIProvider {
  if (config.aiMode === "live" && config.aiProvider === "anthropic" && config.anthropicApiKey) {
    return new AnthropicProvider({
      client: clientFactory(config.anthropicApiKey),
      models: { learn: config.models.learn, fast: config.models.fast },
    });
  }
  if (config.aiMode === "live" && config.aiProvider === "groq" && config.groqApiKey) {
    return new GroqProvider({
      client: groqClientFactory(config.groqApiKey),
      models: { learn: config.groqModels.learn, fast: config.groqModels.fast },
    });
  }
  return new DemoProvider();
}
