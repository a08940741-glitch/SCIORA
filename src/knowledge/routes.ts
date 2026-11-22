import type { FastifyInstance } from "fastify";
import { rejectNonEnglish, sendError } from "../http.ts";
import { ProviderError } from "../ai/provider.ts";
import { KnowledgeQueryRequest, TransformRequest } from "./schemas.ts";
import type { KnowledgeService } from "./service.ts";

/**
 * Knowledge Explorer HTTP routes. Registered inside buildApp, so they inherit every
 * existing protection: helmet CSP, per-IP rate limit, 32 KB body limit, zod error
 * handling, log redaction. Stateless: cards are stored only in the browser.
 *
 * A live provider failure is returned as an error — never replaced by demo content.
 * Internal prompts are never included in any response.
 */
export function registerKnowledgeRoutes(app: FastifyInstance, opts: { service: KnowledgeService; takeBudget: () => boolean }) {
  const { service, takeBudget } = opts;

  app.post("/api/knowledge/query", async (req, reply) => {
    const body = KnowledgeQueryRequest.parse(req.body);
    if (rejectNonEnglish(reply, body.question)) return reply;
    if (!takeBudget()) return sendError(reply, 503, "daily_limit", "SCIORA reached its daily AI usage limit. Please try again tomorrow.");
    try {
      return await service.query(body);
    } catch (err) {
      if (err instanceof ProviderError) {
        req.log.warn({ providerError: err.code }, "knowledge query failed");
        return sendError(reply, err.httpStatus, err.code, err.message, err.retryAfterSec);
      }
      throw err;
    }
  });

  app.post("/api/knowledge/transform", async (req, reply) => {
    const body = TransformRequest.parse(req.body);
    if (rejectNonEnglish(reply, body.content.topic, body.content.summary, ...body.content.points)) return reply;
    if (!takeBudget()) return sendError(reply, 503, "daily_limit", "SCIORA reached its daily AI usage limit. Please try again tomorrow.");
    try {
      return await service.transform(body);
    } catch (err) {
      if (err instanceof ProviderError) {
        req.log.warn({ providerError: err.code }, "knowledge transform failed");
        return sendError(reply, err.httpStatus, err.code, err.message, err.retryAfterSec);
      }
      throw err;
    }
  });
}
