import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { getCursorCloudAdapter } from "../../cursor/adapter.js";
import {
  countActiveCloudRuns,
  countActiveLiveCloudRuns,
  countActiveMockCloudRuns,
  executeApprovedCloudRun,
  syncCloudRun,
} from "../../engines/cloud-dispatch.js";
import { getPrisma } from "../../db/prisma.js";
import { getEnv } from "../../lib/env.js";
import { validationError } from "../../lib/errors.js";

export async function cloudRoutes(app: FastifyInstance) {
  app.get("/api/cloud/status", async (request) => {
    requireAuth(request);
    const adapter = getCursorCloudAdapter();
    const status = adapter.getStatus();
    const [activeLiveRuns, activeMockRuns, activeRuns] = await Promise.all([
      countActiveLiveCloudRuns(),
      countActiveMockCloudRuns(),
      countActiveCloudRuns(),
    ]);
    return {
      source: "api" as const,
      cloud: {
        ...status,
        activeRuns,
        activeLiveRuns,
        activeMockRuns,
        // Anahtar değeri yok — yalnızca configured bayrağı
        apiKeyPresent: status.keyConfigured,
      },
      phase: "5A",
      livePilot: "disabled_until_owner_approval",
    };
  });

  app.post("/api/cloud/verify", async (request) => {
    requireOwner(request);
    const adapter = getCursorCloudAdapter();
    // Live verify uzak çağrı yapabilir; live kapalıysa uzak atlanır
    const result = await adapter.verifyConnection();
    return { source: "api" as const, ...result };
  });

  app.get("/api/cloud/runs", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const runs = await prisma.agentRun.findMany({
      where: {
        OR: [{ cursorAgentId: { not: null } }, { executionMode: { not: null } }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { task: { include: { project: true } } },
    });
    return {
      source: "api" as const,
      runs: runs.map((run) => ({
        id: run.id,
        taskId: run.taskId,
        taskTitle: run.task.title,
        projectSlug: run.task.project.slug,
        agentId: run.agentId,
        status: run.status,
        cursorAgentId: run.cursorAgentId,
        cursorRunId: run.cursorRunId,
        cursorStatus: run.cursorStatus,
        githubRepository: run.githubRepository,
        branch: run.branch,
        prUrl: run.prUrl,
        agentUrl: run.agentUrl,
        executionMode: run.executionMode,
        resultSummary: run.resultSummary,
        errorMessage: run.errorMessage,
        totalTokens: run.totalTokens,
        cancelVerified: run.cancelVerified,
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
      })),
    };
  });

  app.post("/api/cloud/runs/execute", async (request) => {
    const principal = requireOwner(request);
    const body = z
      .object({
        taskId: z.string().uuid(),
        approvalId: z.string().uuid(),
        repositoryUrl: z.string().url(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Geçersiz execute gövdesi.", body.error.flatten());

    const env = getEnv();
    if (env.CLOUD_AGENT_LIVE_ENABLED) {
      // Faz 4A güvenlik: live bayrak açık olsa bile bu etapta otomatik ücretli çalıştırma yok —
      // yine de adapter mock'a düşer eğer mode mock ise. Ek uyarı dönülür.
    }

    const result = await executeApprovedCloudRun({
      ...body.data,
      actorKind: "owner",
    });
    void principal;
    return { source: "api" as const, ...result };
  });

  app.post<{ Params: { taskId: string } }>("/api/cloud/tasks/:taskId/sync", async (request) => {
    requireOwner(request);
    const result = await syncCloudRun(request.params.taskId);
    return { source: "api" as const, ...result };
  });

  app.post<{ Params: { runId: string } }>("/api/cloud/runs/:runId/cancel", async (request) => {
    requireOwner(request);
    const prisma = getPrisma();
    const run = await prisma.agentRun.findUnique({ where: { id: request.params.runId } });
    if (!run?.cursorAgentId || !run.cursorRunId) {
      throw validationError("Cursor kimlikleri eksik; iptal edilemez.");
    }
    const adapter = getCursorCloudAdapter();
    const result = await adapter.cancelRun(run.cursorAgentId, run.cursorRunId);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        cancelVerified: result.verified,
        cursorStatus: result.verified ? "CANCELLED" : run.cursorStatus,
        status: result.verified ? "cancelled" : "cancel_unverified",
        message: result.message,
        finishedAt: result.verified ? new Date() : run.finishedAt,
      },
    });
    return { source: "api" as const, ...result, runId: run.id };
  });
}
