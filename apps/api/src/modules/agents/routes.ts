import { AGENT_IDS, deriveAgentStatusFromTasks } from "@synaptech/shared";
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../../auth/context.js";
import { getPrisma } from "../../db/prisma.js";
import { buildAgentRuntimeSummary } from "../../engines/agent-runtime-summary.js";
import { listTasks } from "../../engines/task-engine.js";
import { notFound } from "../../lib/errors.js";

export async function agentRoutes(app: FastifyInstance) {
  /** Per-agent canlı özet — MSSQL Task/AgentMessage/Audit/Cloud (arşivli hariç). */
  app.get("/api/agents/runtime-summary", async (request) => {
    requireAuth(request);
    return buildAgentRuntimeSummary();
  });

  app.get("/api/agents", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const agents = await prisma.agent.findMany({ orderBy: { id: "asc" } });
    const tasks = await listTasks({});
    const now = new Date();
    return {
      agents: agents.map((agent) => {
        const derived = deriveAgentStatusFromTasks(agent.id as (typeof AGENT_IDS)[number], tasks, {
          enabled: agent.enabled,
          now,
        });
        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          department: agent.department,
          enabled: agent.enabled,
          readonlyRole: agent.readonlyRole,
          status: derived.status,
          statusBasis: derived.basis,
          currentTaskId: derived.currentTaskId,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
    if (!agent) throw notFound("Ajan bulunamadı.");
    const tasks = await listTasks({ assignee: agent.id });
    const derived = deriveAgentStatusFromTasks(agent.id as (typeof AGENT_IDS)[number], tasks, {
      enabled: agent.enabled,
      now: new Date(),
    });
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        department: agent.department,
        enabled: agent.enabled,
        readonlyRole: agent.readonlyRole,
        status: derived.status,
        statusBasis: derived.basis,
        currentTaskId: derived.currentTaskId,
      },
    };
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/tasks", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
    if (!agent) throw notFound("Ajan bulunamadı.");
    const tasks = await listTasks({ assignee: agent.id });
    return { tasks };
  });
}
