import type { MessagesClient } from "../../src/ai/anthropic-provider.ts";

export type FakeStep = Record<string, unknown> | Error | (() => Promise<Record<string, unknown>>);

/**
 * Fake Anthropic client: returns scripted responses, records every call.
 * Used everywhere in `npm test` so that NO real API call can happen.
 */
export function fakeClient(steps: FakeStep[]) {
  const calls: { params: any; options: any }[] = [];
  let i = 0;
  const client: MessagesClient = {
    beta: {
      messages: {
        parse: async (params: any, options?: any) => {
          calls.push({ params, options });
          const step = steps[Math.min(i++, steps.length - 1)];
          if (step instanceof Error) throw step;
          if (typeof step === "function") return step();
          return step as Record<string, unknown>;
        },
      },
    },
  };
  return { client, calls };
}

export function okResponse(parsed: unknown, model: string, extra: Record<string, unknown> = {}) {
  return { stop_reason: "end_turn", parsed_output: parsed, model, usage: { input_tokens: 1, output_tokens: 1 }, ...extra };
}
