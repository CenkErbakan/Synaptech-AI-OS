import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { ApiError, toErrorBody } from "./lib/errors.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { approvalRoutes } from "./modules/approvals/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { autonomyRoutes } from "./modules/autonomy/routes.js";
import { coordinationRoutes } from "./modules/coordination/routes.js";
import { growthRoutes } from "./modules/growth/routes.js";
import { cloudRoutes } from "./modules/cloud/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { opsRoutes } from "./modules/ops/routes.js";
import { systemRoutes } from "./modules/system/routes.js";
import { integrationRoutes } from "./modules/integrations/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { getPrisma } from "./db/prisma.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, {
    origin: ["http://127.0.0.1:3100", "http://localhost:3100"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "SynapTech AI OS API",
        description:
          "Faz 4A Control Layer — görev, onay, kill switch, Cursor Cloud adapter (varsayılan mock; live kapalı).",
        version: "0.4.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(toErrorBody(error));
    }
    if (error && typeof error === "object" && "validation" in error) {
      const validation = (error as { validation?: unknown }).validation;
      return reply.status(400).send({
        error: { code: "ValidationError", message: "İstek doğrulaması başarısız.", details: validation },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: { code: "InternalError", message: "Beklenmeyen sunucu hatası." },
    });
  });

  await app.register(systemRoutes);
  await app.register(integrationRoutes);
  await app.register(agentRoutes);
  await app.register(taskRoutes);
  await app.register(approvalRoutes);
  await app.register(auditRoutes);
  await app.register(cloudRoutes);
  await app.register(autonomyRoutes);
  await app.register(coordinationRoutes);
  await app.register(growthRoutes);
  await app.register(aiRoutes);
  await app.register(opsRoutes);

  app.get("/api/projects", async (request) => {
    const { requireAuth } = await import("./auth/context.js");
    requireAuth(request);
    const projects = await getPrisma().project.findMany({ orderBy: { slug: "asc" } });
    return {
      source: "api" as const,
      projects: projects.map((project) => ({
        id: project.id,
        slug: project.slug,
        name: project.name,
        description: project.description,
        status: project.status,
        githubRepoUrl: project.githubRepoUrl,
        cloudAgentEnabled: project.cloudAgentEnabled,
      })),
    };
  });

  return app;
}
