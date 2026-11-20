import { loadConfig, ConfigError } from "./config.ts";
import { createProvider } from "./ai/index.ts";
import { buildApp } from "./app.ts";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`SCIORA configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const provider = createProvider(config);
  const { app, replay } = await buildApp({ config, provider });
  replay.startSweeper();

  if (provider.simulated) {
    app.log.warn("DEMO MODE: responses are pre-written simulated content. No AI calls will be made.");
  } else {
    app.log.warn({ models: provider.models }, "LIVE MODE: real AI calls will be made and billed.");
  }
  if (config.tokenSecretEphemeral) {
    app.log.warn("SCIORA_TOKEN_SECRET not set: using a temporary key. Exercise tokens become invalid on restart.");
  }

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error("SCIORA failed to start:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
