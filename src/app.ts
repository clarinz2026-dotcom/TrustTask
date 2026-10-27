import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { getPool } from "./db/pool.js";
import { AppError } from "./http/errors.js";
import { registerAuthRoutes } from "./http/auth-routes.js";
import { registerTaskRoutes } from "./http/task-routes.js";
import { registerSubmissionRoutes } from "./http/submission-routes.js";
import { registerSupportRoutes } from "./http/support-routes.js";
import { registerPaymentRoutes } from "./http/payment-routes.js";
import { registerLedgerRoutes } from "./http/ledger-routes.js";
import {
  metricsContentType,
  recordHttpRequest,
  renderMetrics,
} from "./observability/metrics.js";
import {
  captureServerError,
  configureErrorTracking,
} from "./observability/error-tracking.js";

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  configureErrorTracking(config.SENTRY_DSN, config.NODE_ENV);
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.headers.x-api-key",
                "req.body.password",
                "req.body.token",
                "res.headers.set-cookie",
              ],
              censor: "[REDACTED]",
            },
          },
  });
  app.decorateRequest("actor", null);

  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    recordHttpRequest(
      {
        method: request.method,
        route,
        status_code: String(reply.statusCode),
      },
      reply.elapsedTime,
    );
    request.log.info(
      {
        requestId: request.id,
        route,
        actorId: request.actor?.id,
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime,
      },
      "Request completed",
    );
  });

  await app.register(cors, { origin: config.CORS_ORIGIN });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await registerAuthRoutes(app);
  await registerTaskRoutes(app);
  await registerSubmissionRoutes(app);
  await registerSupportRoutes(app);
  await registerPaymentRoutes(app);
  await registerLedgerRoutes(app);

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/metrics", async (_request, reply) => {
    return reply.type(metricsContentType).send(await renderMetrics());
  });
  app.get("/health/ready", async (_request, reply) => {
    try {
      await getPool().query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          requestId: request.id,
        },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
          requestId: request.id,
        },
      });
    }
    request.log.error(
      {
        requestId: request.id,
        route: request.routeOptions.url,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "Unhandled request error",
    );
    captureServerError(error, {
      requestId: request.id,
      route: request.routeOptions.url ?? "unmatched",
      actorId: request.actor?.id,
    });
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.id,
      },
    });
  });

  return app;
}
