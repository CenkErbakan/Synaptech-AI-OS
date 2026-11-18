import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { getPrisma } from "../../db/prisma.js";
import { answerCeoChat, buildCeoChatContext } from "../../engines/ceo-chat.js";
import {
  completeChainStep,
  failChainStep,
  getChainSnapshot,
  simulateFullChainSuccess,
  startChainStep,
  startSoftwareDeliveryChain,
} from "../../engines/coordination-engine.js";

export async function coordinationRoutes(app: FastifyInstance) {
  app.get("/api/coordination/status", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const [chains, steps, messages] = await Promise.all([
      prisma.task.count({ where: { chainId: { not: null }, parentTaskId: null } }),
      prisma.task.count({ where: { chainId: { not: null }, parentTaskId: { not: null } } }),
      prisma.agentMessage.count({ where: { chainId: { not: null } } }),
    ]);
    return {
      source: "api" as const,
      phase: "5B",
      mode: "deterministic_coordination",
      realAiExecution: false,
      llmIntegrated: false,
      counts: { chains, steps, messages },
    };
  });

  app.get("/api/coordination/chains", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const parents = await prisma.task.findMany({
      where: { source: "real", archivedAt: null, chainId: { not: null }, parentTaskId: null },
      include: { project: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return {
      source: "api" as const,
      realAiExecution: false,
      chains: parents.map((p) => ({
        parentTaskId: p.id,
        chainId: p.chainId,
        title: p.title,
        status: p.status,
        workflowPhase: p.workflowPhase,
        projectSlug: p.project.slug,
        executionKind: p.executionKind,
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  });

  app.get("/api/coordination/chains/:chainId", async (request) => {
    requireAuth(request);
    const { chainId } = request.params as { chainId: string };
    return getChainSnapshot(chainId);
  });

  app.get("/api/coordination/messages", async (request) => {
    requireAuth(request);
    const query = z
      .object({
        chainId: z.string().uuid().optional(),
        since: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);
    const prisma = getPrisma();
    const messages = await prisma.agentMessage.findMany({
      where: {
        ...(query.chainId ? { chainId: query.chainId } : { chainId: { not: null } }),
        ...(query.since ? { createdAt: { gt: new Date(query.since) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
    return {
      source: "api" as const,
      realAiExecution: false,
      messages: messages.map((m) => ({
        id: m.id,
        fromAgentId: m.fromAgentId,
        toAgentId: m.toAgentId,
        taskId: m.taskId,
        parentTaskId: m.parentTaskId,
        chainId: m.chainId,
        kind: m.kind,
        summary: m.summary,
        evidenceRef: m.evidenceRef,
        payloadJson: m.payloadJson,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

  /** Kontrollü polling feed — DEMO karışmaz (yalnızca source=real / MSSQL). */
  app.get("/api/coordination/feed", async (request) => {
    requireAuth(request);
    const query = z
      .object({
        since: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      })
      .parse(request.query);
    const prisma = getPrisma();
    const since = query.since ? new Date(query.since) : new Date(Date.now() - 60 * 60_000);
    const [events, messages, steps] = await Promise.all([
      prisma.taskEvent.findMany({
        where: { at: { gt: since }, task: { source: "real", chainId: { not: null } } },
        orderBy: { at: "desc" },
        take: query.limit,
        include: { task: { select: { id: true, title: true, chainId: true, chainStep: true, assigneeId: true } } },
      }),
      prisma.agentMessage.findMany({
        where: { createdAt: { gt: since }, chainId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: query.limit,
      }),
      prisma.task.findMany({
        where: { source: "real", archivedAt: null, chainId: { not: null }, updatedAt: { gt: since } },
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        select: {
          id: true,
          title: true,
          status: true,
          workflowPhase: true,
          chainId: true,
          chainStep: true,
          assigneeId: true,
          updatedAt: true,
        },
      }),
    ]);
    return {
      source: "api" as const,
      realAiExecution: false,
      serverTime: new Date().toISOString(),
      events: events.map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        type: e.type,
        message: e.message,
        taskId: e.taskId,
        chainId: e.task.chainId,
        chainStep: e.task.chainStep,
        assigneeId: e.task.assigneeId,
      })),
      messages: messages.map((m) => ({
        id: m.id,
        at: m.createdAt.toISOString(),
        kind: m.kind,
        summary: m.summary,
        from: m.fromAgentId,
        to: m.toAgentId,
        chainId: m.chainId,
      })),
      steps: steps.map((s) => ({
        id: s.id,
        at: s.updatedAt.toISOString(),
        title: s.title,
        status: s.status,
        workflowPhase: s.workflowPhase,
        chainId: s.chainId,
        chainStep: s.chainStep,
        assigneeId: s.assigneeId,
      })),
    };
  });

  /** SSE — kontrollü olay akışı (gerçek MSSQL; DEMO yok). */
  app.get("/api/coordination/events", async (request, reply) => {
    requireAuth(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const prisma = getPrisma();
    let last = new Date();
    const write = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    write("hello", {
      source: "api",
      realAiExecution: false,
      llmIntegrated: false,
      at: new Date().toISOString(),
    });

    const timer = setInterval(() => {
      void (async () => {
        try {
          const messages = await prisma.agentMessage.findMany({
            where: { createdAt: { gt: last }, chainId: { not: null } },
            orderBy: { createdAt: "asc" },
            take: 20,
          });
          for (const m of messages) {
            write("message", {
              id: m.id,
              kind: m.kind,
              summary: m.summary,
              from: m.fromAgentId,
              to: m.toAgentId,
              chainId: m.chainId,
              at: m.createdAt.toISOString(),
            });
            last = m.createdAt > last ? m.createdAt : last;
          }
          write("ping", { at: new Date().toISOString() });
        } catch {
          write("error", { message: "feed_error" });
        }
      })();
    }, 3000);

    request.raw.on("close", () => {
      clearInterval(timer);
      reply.raw.end();
    });
  });

  app.post("/api/coordination/chains/start", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        projectSlug: z.enum(["synaptech-ai-os", "synaptech", "subify", "marivo"]),
        title: z.string().min(3).max(140),
        description: z.string().max(4000).optional(),
        opportunityId: z.string().uuid().optional(),
        idempotencyKey: z.string().min(8).max(120),
      })
      .parse(request.body);
    const result = await startSoftwareDeliveryChain({
      ...body,
      executionKind: "deterministic",
    });
    return { source: "api" as const, ...result };
  });

  app.post("/api/coordination/steps/:taskId/start", async (request) => {
    requireOwner(request);
    const { taskId } = request.params as { taskId: string };
    const result = await startChainStep(taskId);
    return { source: "api" as const, realAiExecution: false, ...result };
  });

  app.post("/api/coordination/steps/:taskId/complete", async (request) => {
    requireOwner(request);
    const { taskId } = request.params as { taskId: string };
    const body = z.object({ result: z.string().min(1).max(8000) }).parse(request.body ?? {});
    const result = await completeChainStep({ taskId, result: body.result });
    return { source: "api" as const, realAiExecution: false, ...result };
  });

  app.post("/api/coordination/steps/:taskId/fail", async (request) => {
    requireOwner(request);
    const { taskId } = request.params as { taskId: string };
    const body = z.object({ reason: z.string().min(1).max(2000) }).parse(request.body ?? {});
    const result = await failChainStep({ taskId, reason: body.reason });
    return { source: "api" as const, realAiExecution: false, ...result };
  });

  app.post("/api/coordination/chains/:chainId/simulate", async (request) => {
    requireOwner(request);
    const { chainId } = request.params as { chainId: string };
    const result = await simulateFullChainSuccess(chainId);
    return { source: "api" as const, ...result };
  });

  app.get("/api/coordination/ceo-chat/context", async (request) => {
    requireAuth(request);
    return buildCeoChatContext();
  });

  app.post("/api/coordination/ceo-chat/message", async (request) => {
    requireAuth(request);
    const body = z.object({ message: z.string().min(1).max(2000) }).parse(request.body ?? {});
    return answerCeoChat(body.message);
  });

  app.patch("/api/coordination/ceo-chat/goals", async (request) => {
    requireOwner(request);
    const { updateCompanyGoalByOwner } = await import("../../engines/ceo-chat.js");
    const body = z
      .object({
        goalKey: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        kpiLabel: z.string().max(120).optional(),
        currentValue: z.string().max(200).optional(),
      })
      .parse(request.body ?? {});
    try {
      return { source: "api" as const, ...(await updateCompanyGoalByOwner(body)) };
    } catch (error) {
      const { validationError } = await import("../../lib/errors.js");
      throw validationError(error instanceof Error ? error.message : "Hedef güncellenemedi.");
    }
  });
}
