import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.ts";
import { AnthropicProvider, type MessagesClient } from "./anthropic-provider.ts";
import { DemoProvider } from "./demo-provider.ts";
import type { AIProvider } from "./provider.ts";

export type ClientFactory = (apiKey: string) => MessagesClient;

/** Creates the real SDK client. Only ever called in live mode. */
export const defaultClientFactory: ClientFactory = (apiKey) =>
  new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 }) as unknown as MessagesClient;

/**
 * Chooses the provider. Live AI ONLY when config.aiMode === "live" (which itself
 * requires a key). In every other case the DemoProvider is used and no client is created.
 */
export function createProvider(config: Config, clientFactory: ClientFactory = defaultClientFactory): AIProvider {
  if (config.aiMode === "live" && config.anthropicApiKey) {
    return new AnthropicProvider({
      client: clientFactory(config.anthropicApiKey),
      models: { learn: config.models.learn, fast: config.models.fast },
    });
  }
  return new DemoProvider();
}
