import type { Config } from "../config.ts";
import { defaultClientFactory, type ClientFactory } from "../ai/index.ts";
import { AnthropicKnowledgeProvider } from "./anthropic-provider.ts";
import { DemoKnowledgeProvider } from "./demo-provider.ts";
import type { KnowledgeProvider } from "./provider.ts";

/**
 * Chooses the Knowledge Explorer provider with EXACTLY the same rule as Phase 1:
 * live only when config.aiMode === "live" (which requires a key). Otherwise demo,
 * and no SDK client is created.
 */
export function createKnowledgeProvider(config: Config, clientFactory: ClientFactory = defaultClientFactory): KnowledgeProvider {
  if (config.aiMode === "live" && config.anthropicApiKey) {
    return new AnthropicKnowledgeProvider({
      client: clientFactory(config.anthropicApiKey),
      models: { learn: config.models.learn, fast: config.models.fast },
    });
  }
  return new DemoKnowledgeProvider();
}
