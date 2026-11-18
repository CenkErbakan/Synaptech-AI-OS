import { NewTaskInputSchema, type CeoTaskSubmission } from "@synaptech/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { actorFromPrincipal, requireAuth, requireOwner } from "../../auth/context.js";
import {
  applyRealTaskAction,
  createRealTask,
  loadTask,
  listTasks,
  reassignTaskProject,
  submitCeoTask,
  tryDispatch,
} from "../../engines/task-engine.js";
import { validationError } from "../../lib/errors.js";

export async function taskRoutes(app: FastifyInstance) {
  app.get("/api/tasks", async (request) => {
    requireAuth(request);
    const query = z
      .object({
        project: z.string().optional(),
        assignee: z.string().optional(),
        status: z.string().optional(),
        /** archived=1 → arşiv; archived=all → hepsi; yok → aktif */
        archived: z.enum(["0", "1", "true", "false", "all"]).optional(),
        epoch: z.enum(["current", "legacy", "all"]).optional(),
      })
      .parse(request.query);
    const archived =
      query.archived === "all"
        ? ("all" as const)
        : query.archived === "1" || query.archived === "true"
          ? true
          : false;
    const tasks = await listTasks({
      projectSlug: query.project,
      assignee: query.assignee,
      status: query.status,
      archived,
      epoch: query.epoch ?? "current",
    });
    return {
      tasks,
      filter: {
        archived: archived === false ? "active" : archived === true ? "archived" : "all",
        epoch: query.epoch ?? "current",
      },
    };
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request) => {
    requireAuth(request);
    const task = await loadTask(request.params.id);
    return { task };
  });

  app.post("/api/tasks", async (request) => {
    const principal = requireOwner(request);
    const idempotencyKey =
      (typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : undefined) ?? undefined;
    const parsed = NewTaskInputSchema.safeParse({
      ...(request.body as object),
      idempotencyKey: idempotencyKey ?? (request.body as { idempotencyKey?: string })?.idempotencyKey,
    });
    if (!parsed.success) throw validationError("Görev doğrulaması başarısız.", parsed.error.flatten());
    const task = await createRealTask(parsed.data, actorFromPrincipal(principal));
    return { task };
  });

  app.post("/api/tasks/ceo", async (request) => {
    const principal = requireOwner(request);
    const idempotencyKey =
      typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : undefined;
    const body = {
      ...(typeof request.body === "object" && request.body ? (request.body as Record<string, unknown>) : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    } as CeoTaskSubmission;
    const task = await submitCeoTask(body, actorFromPrincipal(principal));
    return { task };
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (request) => {
    const principal = requireOwner(request);
    const body = z
      .object({
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        title: z.string().min(3).max(140).optional(),
        description: z.string().max(2000).optional(),
        assignee: z.string().optional(),
        projectSlug: z.string().min(1).optional(),
        note: z.string().max(500).optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Geçersiz güncelleme.", body.error.flatten());

    const actor = actorFromPrincipal(principal);
    if (body.data.projectSlug) {
      await reassignTaskProject(
        request.params.id,
        body.data.projectSlug,
        actor,
        body.data.note,
      );
    }

    // Durum rastgele PATCH ile değiştirilmez; yalnızca alan güncellemesi.
    const current = await loadTask(request.params.id);
    if (body.data.priority || body.data.title || body.data.description || body.data.assignee) {
      const { getPrisma } = await import("../../db/prisma.js");
      await getPrisma().task.update({
        where: { id: current.id },
        data: {
          ...(body.data.priority ? { priority: body.data.priority } : {}),
          ...(body.data.title ? { title: body.data.title } : {}),
          ...(body.data.description ? { description: body.data.description } : {}),
          ...(body.data.assignee ? { assigneeId: body.data.assignee } : {}),
        },
      });
      if (body.data.assignee && body.data.assignee !== current.assignee) {
        await getPrisma().taskAssignment.create({
          data: { taskId: current.id, agentId: body.data.assignee, note: "Yeniden atama" },
        });
      }
    }
    return { task: await loadTask(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/cancel", async (request) => {
    const principal = requireOwner(request);
    const body = z.object({ reason: z.string().max(500).optional() }).safeParse(request.body ?? {});
    const task = await applyRealTaskAction(
      request.params.id,
      { type: "cancel", reason: body.success ? body.data.reason : undefined },
      actorFromPrincipal(principal),
    );
    return { task };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/pause", async (request) => {
    const principal = requireOwner(request);
    const body = z.object({ reason: z.string().max(500).optional() }).safeParse(request.body ?? {});
    const task = await applyRealTaskAction(
      request.params.id,
      { type: "pause", reason: body.success ? body.data.reason : undefined },
      actorFromPrincipal(principal),
    );
    return { task };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/resume", async (request) => {
    const principal = requireOwner(request);
    const task = await applyRealTaskAction(request.params.id, { type: "resume" }, actorFromPrincipal(principal));
    return { task };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/retry", async (request) => {
    const principal = requireOwner(request);
    const task = await applyRealTaskAction(request.params.id, { type: "restart" }, actorFromPrincipal(principal));
    return { task };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/dispatch", async (request) => {
    requireOwner(request);
    const task = await tryDispatch(request.params.id);
    return {
      task,
      note: "Faz 4A: onaysız dispatch Cloud create yapmaz; cloud_agent_run onayı + /api/cloud/runs/execute gerekir. Live varsayılan kapalı.",
    };
  });
}
