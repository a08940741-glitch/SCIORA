import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import { ZodError } from "zod";
import type { Config } from "./config.ts";
import type { AIProvider } from "./ai/provider.ts";
import { DemoProvider } from "./ai/demo-provider.ts";
import { ProviderError } from "./ai/provider.ts";
import { ExerciseTokenCodec, TokenError } from "./domain/exercise-token.ts";
import { ReplayStore, createAnswerHasher } from "./domain/replay-store.ts";
import { enforceLessonIntegrity } from "./domain/lesson-integrity.ts";
import { GradeRequest, LessonRequest, toPublicLesson, type GradeResult } from "./domain/schemas.ts";
import { gradeExpression, gradeMcq, gradeNumeric, isValidChoice, type DeterministicOutcome } from "./domain/grading.ts";
import { normalizeAnswer } from "./domain/normalize.ts";
import { aggregate } from "./domain/rubric-aggregate.ts";
import { correctAnswerText, ruleFeedback, uncertaintyText, UNREADABLE_HINT } from "./domain/feedback.ts";
import { DailyBudget, sendError } from "./http.ts";
import type { KnowledgeProvider } from "./knowledge/provider.ts";
import type { SourceRetriever } from "./knowledge/retriever.ts";
import { DemoKnowledgeProvider } from "./knowledge/demo-provider.ts";
import { KnowledgeService } from "./knowledge/service.ts";
import { registerKnowledgeRoutes } from "./knowledge/routes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");

export interface AppDeps {
  config: Config;
  provider: AIProvider;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  /**
   * Knowledge Explorer provider. Production (server.ts) always passes one created with the
   * same demo/live rule as Phase 1. Defaults to the demo provider (used by tests).
   */
  knowledgeProvider?: KnowledgeProvider;
  /** Source retriever. Defaults to NoopRetriever (decision D1: no real retrieval). */
  retriever?: SourceRetriever;
  /** Capture logs in tests. */
  logStream?: Writable;
  logLevel?: string;
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; replay: ReplayStore }> {
  const { config, provider } = deps;
  const now = deps.now ?? Date.now;

  const app = Fastify({
    bodyLimit: 32 * 1024,
    logger: {
      level: deps.logLevel ?? (config.nodeEnv === "test" ? "warn" : "info"),
      // Defence in depth: bodies are not logged by default; redact anything sensitive anyway.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-api-key']", "token", "answer", "apiKey", "*.token", "*.answer", "*.apiKey"],
        censor: "[REDACTED]",
      },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    trustProxy: config.nodeEnv === "production",
  });

  const codec = new ExerciseTokenCodec({ secrets: [config.tokenSecret], ttlSeconds: config.tokenTtlSeconds, now });
  const replay = new ReplayStore({ maxEntries: config.replay.maxEntries, highWater: config.replay.highWater, now });
  const hashAnswer = createAnswerHasher(config.tokenSecret);
  const budget = new DailyBudget(config.dailyLimit, now);
  const isLive = !provider.simulated;
  const takeBudget = () => !isLive || budget.take();
  const knowledgeProvider = deps.knowledgeProvider ?? new DemoKnowledgeProvider();
  const knowledge = new KnowledgeService({ provider: knowledgeProvider, retriever: deps.retriever, now });
  // Same shared daily budget; demo knowledge calls cost nothing and are not counted.
  const takeKnowledgeBudget = () => knowledgeProvider.simulated || budget.take();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: "1 minute",
    allowList: (req) => !req.url.startsWith("/api/"),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "rate_limited",
      message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`,
    }),
  });

  await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ["index.html"] });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return sendError(reply, 400, "invalid_request", "The request is not valid.", undefined, {
        fields: [...new Set(err.issues.map((i) => i.path.join(".") || "(body)"))],
      });
    }
    const e = err as { statusCode?: number; code?: string };
    if (e.statusCode === 429) return reply.code(429).send(err);
    if (e.statusCode === 413 || e.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendError(reply, 413, "payload_too_large", "The request is too large.");
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return sendError(reply, e.statusCode, "bad_request", "The request could not be processed.");
    }
    req.log.error({ errName: (err as Error).name }, "unhandled error");
    return sendError(reply, 500, "internal_error", "Something went wrong on the server.");
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return sendError(reply, 404, "not_found", "Unknown API endpoint.");
    return reply.code(404).type("text/plain").send("Not found");
  });

  // ------------------------------------------------------------------ health
  app.get("/api/health", async () => ({
    status: "ok",
    phase: 1,
    mode: isLive ? "live" : "demo",
    simulated: provider.simulated,
    models: provider.models,
    demoTopics: provider instanceof DemoProvider ? provider.topics() : null,
    tokenSecretEphemeral: config.tokenSecretEphemeral,
    knowledge: {
      mode: knowledgeProvider.simulated ? "demo" : "live",
      simulated: knowledgeProvider.simulated,
      models: knowledgeProvider.models,
      demoTopics: knowledgeProvider instanceof DemoKnowledgeProvider ? knowledgeProvider.topics() : null,
      sourceRetrieval: knowledge.retriever.enabled,
      retriever: knowledge.retriever.enabled ? knowledge.retriever.name : null,
    },
    plannedNotImplemented: ["evidence_analyzer", "progress_screen", "google_sign_in"],
  }));

  registerKnowledgeRoutes(app, { service: knowledge, takeBudget: takeKnowledgeBudget });

  // ------------------------------------------------------------------ learn
  app.post("/api/learn", async (req, reply) => {
    const body = LessonRequest.parse(req.body);

    const issue = replay.canIssueNewSet();
    if (!issue.ok) {
      return sendError(reply, 503, "capacity_exceeded", "SCIORA is temporarily busy. No new exercises can be created right now. Please try again later.", issue.retryAfterSec);
    }
    if (!takeBudget()) return sendError(reply, 503, "daily_limit", "SCIORA reached its daily AI usage limit. Please try again tomorrow.");

    let out;
    try {
      out = await provider.generateLesson(body);
    } catch (err) {
      if (err instanceof ProviderError) {
        req.log.warn({ providerError: err.code }, "lesson generation failed");
        // No silent substitution: a live failure is an error, never demo content.
        return sendError(reply, err.httpStatus, err.code, err.message, err.retryAfterSec);
      }
      throw err;
    }

    const { lesson } = enforceLessonIntegrity(out.lesson);
    const publicLesson = toPublicLesson(lesson);

    if (!lesson.understood.isEducational || lesson.exercises.length === 0) {
      return { lesson: { ...publicLesson, exercises: [] }, exerciseSet: null, meta: out.meta };
    }

    const sealed = codec.seal({
      topic: lesson.understood.topic,
      subject: lesson.understood.subject,
      level: body.level,
      language: body.language,
      exercises: lesson.exercises,
    });
    return {
      lesson: publicLesson,
      exerciseSet: { token: sealed.token, expiresAt: new Date(sealed.exp * 1000).toISOString() },
      meta: out.meta,
    };
  });

  // ------------------------------------------------------------------ grade
  app.post("/api/grade", async (req, reply) => {
    const body = GradeRequest.parse(req.body);

    let payload;
    try {
      payload = codec.open(body.token);
    } catch (err) {
      if (err instanceof TokenError) {
        return err.code === "expired"
          ? sendError(reply, 410, "token_expired", "This exercise expired. Generate a new one.")
          : sendError(reply, 400, "invalid_token", "This exercise token is not valid.");
      }
      throw err;
    }

    const ex = payload.exercises.find((e) => e.id === body.exerciseId);
    if (!ex) return sendError(reply, 400, "unknown_exercise", "This exercise is not part of the exercise set.");

    // Pre-checks that do NOT consume the attempt and reveal nothing about correctness.
    let deterministic: DeterministicOutcome | null = null;
    if (ex.type === "mcq") {
      if (!isValidChoice(ex, body.answer)) return sendError(reply, 400, "invalid_choice", "Choose one of the listed options.");
      deterministic = gradeMcq(ex, body.answer);
    } else if (ex.type === "numeric" || ex.type === "expression") {
      deterministic = ex.type === "numeric" ? gradeNumeric(ex, body.answer) : gradeExpression(ex, body.answer);
      if (deterministic.kind === "unparsed") {
        return sendError(reply, 422, "unreadable_answer", UNREADABLE_HINT[payload.language][ex.type]);
      }
    }

    // Atomic reservation BEFORE any grading work.
    const answerHash = hashAnswer(normalizeAnswer(body.answer));
    const r = replay.reserve(payload.tid, ex.id, answerHash, payload.exp);
    switch (r.kind) {
      case "in_progress":
        return sendError(reply, 409, "grading_in_progress", "This answer is being graded. Please wait.", r.retryAfterSec);
      case "already_graded":
        return reply.code(409).send({ error: "already_graded", message: "This exercise was already graded. Here is the original result.", result: { ...r.result, replayed: true } });
      case "answer_locked":
        return sendError(reply, 409, "answer_locked", "Grading failed earlier. You can retry only with the same answer.");
      case "capacity":
        return sendError(reply, 503, "capacity_exceeded", "SCIORA is temporarily busy. Your answer was NOT graded. Please try again later.", r.retryAfterSec);
      case "reserved":
        break;
    }

    const base = { exerciseId: ex.id, correctAnswer: correctAnswerText(ex), explanation: ex.explanation };
    let result: GradeResult;

    if (deterministic) {
      const verdict = deterministic.kind === "correct" ? "correct" : "incorrect";
      result = {
        ...base,
        verdict,
        score: verdict === "correct" ? 1 : 0,
        method: "deterministic",
        feedback: ruleFeedback(payload.language, verdict),
        criteria: [],
        misconception: null,
        uncertaintyReason: null,
        gradedBy: { source: "rules", simulated: false, model: null },
        countsTowardEstimate: true,
      };
    } else if (ex.type === "short_text") {
      try {
        if (!takeBudget()) {
          replay.fail(payload.tid, ex.id);
          return sendError(reply, 503, "daily_limit", "SCIORA reached its daily AI usage limit. Your answer was NOT graded.");
        }
        const input = { exercise: ex, answer: body.answer, language: payload.language, subject: payload.subject, level: payload.level };
        let judged = await provider.judgeWritten(input, "fast");
        let agg = aggregate(ex.rubric, judged.judgement, body.answer);
        if (agg.verdict === "uncertain" && config.gradeEscalation && isLive && takeBudget()) {
          judged = await provider.judgeWritten(input, "learn");
          agg = aggregate(ex.rubric, judged.judgement, body.answer);
        }
        result = {
          ...base,
          verdict: agg.verdict,
          score: agg.score,
          method: judged.method,
          feedback: agg.verdict === "uncertain" ? `${ruleFeedback(payload.language, "uncertain")} ${judged.judgement.feedback}` : judged.judgement.feedback,
          criteria: agg.criteria.map((c) => ({ id: c.id, description: c.description, judgement: c.judgement, evidence: c.evidence })),
          misconception: agg.misconception,
          uncertaintyReason: agg.verdict === "uncertain" ? uncertaintyText(payload.language, agg.unclearRequired) : null,
          gradedBy: { source: judged.source, simulated: judged.simulated, model: judged.model },
          countsTowardEstimate: agg.verdict !== "uncertain",
        };
      } catch (err) {
        replay.fail(payload.tid, ex.id);
        if (err instanceof ProviderError) {
          req.log.warn({ providerError: err.code }, "written grading failed");
          return sendError(reply, err.httpStatus, err.code, `${err.message} Your answer was NOT graded; you can retry with the same answer.`, err.retryAfterSec);
        }
        throw err;
      }
    } else {
      replay.fail(payload.tid, ex.id);
      return sendError(reply, 500, "internal_error", "Unsupported exercise type.");
    }

    replay.complete(payload.tid, ex.id, result);
    return { result: { ...result, replayed: false } };
  });

  return { app, replay };
}
