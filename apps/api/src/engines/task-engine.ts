import {
  DEFAULT_MAX_RETRIES,
  applyTaskAction,
  createTask,
  type Actor,
  type CeoTaskSubmission,
  type NewTaskInput,
  type Task,
  type TaskAction,
  TaskTransitionError,
  CeoTaskSubmissionSchema,
} from "@synaptech/shared";
import { randomUUID } from "node:crypto";

import { getCursorCloudAdapter } from "../cursor/adapter.js";
import { getPrisma } from "../db/prisma.js";
import { conflict, killSwitchActive, notFound, validationError } from "../lib/errors.js";
import { mapTask } from "../lib/mappers.js";
import { writeAudit } from "./audit.js";
import { prepareCloudExecutionGate } from "./cloud-dispatch.js";
import { getKillSwitch } from "./kill-switch.js";

function toActorKind(actor: Actor): "owner" | "agent" | "system" {
  if (actor.kind === "user") return "owner";
  if (actor.kind === "agent") return "agent";
  return "system";
}

async function persistTaskSnapshot(task: Task, projectId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.task.upsert({
      where: { id: task.id },
      create: {
        id: task.id,
        source: "real",
        title: task.title,
        description: task.description,
        projectId,
        assigneeId: task.assignee,
        priority: task.priority,
        status: task.status,
        paused: task.paused,
        attempts: task.attempts,
        timeoutMinutes: task.timeoutMinutes,
        dueAt: task.dueAt ? new Date(task.dueAt) : null,
        startedAt: task.startedAt ? new Date(task.startedAt) : null,
        finishedAt: task.finishedAt ? new Date(task.finishedAt) : null,
        dispatchState: task.dispatchState,
        idempotencyKey: task.idempotencyKey ?? null,
        approvalId: task.approvalId ?? null,
        model: task.model ?? null,
        gitBranch: task.git?.branch ?? null,
        gitPrUrl: task.git?.prUrl ?? null,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt),
      },
      update: {
        title: task.title,
        description: task.description,
        assigneeId: task.assignee,
        priority: task.priority,
        status: task.status,
        paused: task.paused,
        attempts: task.attempts,
        timeoutMinutes: task.timeoutMinutes,
        dueAt: task.dueAt ? new Date(task.dueAt) : null,
        startedAt: task.startedAt ? new Date(task.startedAt) : null,
        finishedAt: task.finishedAt ? new Date(task.finishedAt) : null,
        dispatchState: task.dispatchState,
        approvalId: task.approvalId ?? null,
        model: task.model ?? null,
        gitBranch: task.git?.branch ?? null,
        gitPrUrl: task.git?.prUrl ?? null,
        updatedAt: new Date(task.updatedAt),
      },
    });

    const last = task.history[task.history.length - 1];
    if (last) {
      const exists = await tx.taskEvent.findUnique({ where: { id: last.id } });
      if (!exists) {
        await tx.taskEvent.create({
          data: {
            id: last.id,
            taskId: task.id,
            at: new Date(last.at),
            actorKind: toActorKind(last.actor),
            actorAgent: last.actor.kind === "agent" ? last.actor.agentId : null,
            type: last.type,
            message: last.message,
            fromStatus: last.fromStatus ?? null,
            toStatus: last.toStatus ?? null,
          },
        });
      }
    }
  });
}

export async function loadTask(id: string): Promise<Task> {
  const prisma = getPrisma();
  const row = await prisma.task.findUnique({
    where: { id },
    include: { events: { orderBy: { at: "asc" } }, project: true },
  });
  if (!row || row.source !== "real") throw notFound("Görev bulunamadı.");
  return mapTask(row);
}

export async function listTasks(filters: {
  projectSlug?: string;
  assignee?: string;
  status?: string;
  /** true: yalnızca arşiv; false/undefined: yalnızca aktif; "all": hepsi */
  archived?: boolean | "all";
  epoch?: "current" | "legacy" | "all";
}): Promise<Task[]> {
  const prisma = getPrisma();
  const archiveFilter =
    filters.archived === "all"
      ? {}
      : filters.archived === true
        ? { archivedAt: { not: null } }
        : { archivedAt: null };
  const { epochCreatedAtFilter } = await import("./operation-epoch.js");
  const epochFilter = await epochCreatedAtFilter(filters.epoch ?? "current");
  const rows = await prisma.task.findMany({
    where: {
      source: "real",
      ...archiveFilter,
      ...epochFilter,
      ...(filters.assignee ? { assigneeId: filters.assignee } : {}),
      ...(filters.status ? { status: filters.status as Task["status"] } : {}),
      ...(filters.projectSlug ? { project: { slug: filters.projectSlug } } : {}),
    },
    include: { events: { orderBy: { at: "asc" } }, project: true },
    orderBy: { updatedAt: "desc" },
    take: filters.archived === true || filters.archived === "all" ? 500 : 200,
  });
  return rows.map(mapTask);
}

export async function createRealTask(input: NewTaskInput, actor: Actor): Promise<Task> {
  const kill = await getKillSwitch();
  const prisma = getPrisma();

  if (input.idempotencyKey) {
    const existing = await prisma.task.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { events: { orderBy: { at: "asc" } }, project: true },
    });
    if (existing) return mapTask(existing);
  }

  const project = await prisma.project.findUnique({ where: { slug: input.projectSlug } });
  if (!project) throw validationError("Geçersiz proje.");

  const agent = await prisma.agent.findUnique({ where: { id: input.assignee } });
  if (!agent || !agent.enabled) throw validationError("Geçersiz veya kapalı ajan.");

  let domainTask: Task;
  try {
    domainTask = createTask(input, {
      actor,
      now: new Date(),
      killSwitchEnabled: kill.enabled,
      maxRetries: DEFAULT_MAX_RETRIES,
      newId: () => randomUUID(),
      source: "api",
    });
  } catch (error) {
    if (error instanceof TaskTransitionError && error.code === "kill_switch") {
      throw killSwitchActive(error.message);
    }
    if (error instanceof TaskTransitionError) {
      throw validationError(error.message);
    }
    throw error;
  }

  try {
    await persistTaskSnapshot(domainTask, project.id);
    await prisma.taskAssignment.create({
      data: { taskId: domainTask.id, agentId: domainTask.assignee, note: "İlk atama" },
    });
  } catch (error) {
    if (input.idempotencyKey && error instanceof Error && /unique/i.test(error.message)) {
      const again = await prisma.task.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { events: { orderBy: { at: "asc" } }, project: true },
      });
      if (again) return mapTask(again);
      throw conflict("Idempotency çakışması.");
    }
    throw error;
  }

  await writeAudit({
    category: "task",
    action: "task.created",
    actorKind: toActorKind(actor),
    actorAgent: actor.kind === "agent" ? actor.agentId : undefined,
    targetType: "task",
    targetId: domainTask.id,
    summary: `Görev oluşturuldu: ${domainTask.title}`,
    metadata: { project: domainTask.projectSlug, assignee: domainTask.assignee, status: domainTask.status },
  });

  return domainTask;
}

export async function submitCeoTask(input: CeoTaskSubmission, actor: Actor): Promise<Task> {
  const parsed = CeoTaskSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError("CEO görev formu geçersiz.", parsed.error.flatten());
  }
  const data = parsed.data;
  const description = [data.description, data.notes ? `Notlar: ${data.notes}` : ""]
    .filter(Boolean)
    .join("\n\n");

  const task = await createRealTask(
    {
      title: data.title,
      description,
      projectSlug: data.projectSlug,
      assignee: "ceo",
      priority: data.priority,
      initialStatus: "planned",
      dueAt: data.dueAt,
      dispatchState: "awaiting_integration",
      idempotencyKey: data.idempotencyKey,
    },
    actor,
  );

  // Faz 4A: Cloud run otomatik başlamaz — Owner onay kapısı
  const gate = await prepareCloudExecutionGate(task.id);

  await writeAudit({
    category: "task",
    action: "task.ceo_submitted",
    actorKind: toActorKind(actor),
    targetType: "task",
    targetId: task.id,
    summary: "CEO görevi planlandı; Cloud yürütme Owner onayı bekleniyor.",
    metadata: { approvalId: gate.approvalId, dispatchState: gate.dispatchState },
  });

  return loadTask(task.id);
}

export async function applyRealTaskAction(taskId: string, action: TaskAction, actor: Actor): Promise<Task> {
  const kill = await getKillSwitch();
  const current = await loadTask(taskId);
  const prisma = getPrisma();
  const project = await prisma.project.findUnique({ where: { slug: current.projectSlug } });
  if (!project) throw notFound("Proje bulunamadı.");

  let next: Task;
  try {
    next = applyTaskAction(current, action, {
      actor,
      now: new Date(),
      killSwitchEnabled: kill.enabled,
      maxRetries: DEFAULT_MAX_RETRIES,
      newId: () => randomUUID(),
    });
  } catch (error) {
    if (error instanceof TaskTransitionError && error.code === "kill_switch") {
      throw killSwitchActive(error.message);
    }
    if (error instanceof TaskTransitionError) {
      throw validationError(error.message);
    }
    throw error;
  }

  await persistTaskSnapshot(next, project.id);
  await writeAudit({
    category: "task",
    action: `task.${action.type}`,
    actorKind: toActorKind(actor),
    actorAgent: actor.kind === "agent" ? actor.agentId : undefined,
    targetType: "task",
    targetId: next.id,
    summary: next.history[next.history.length - 1]?.message ?? `Görev güncellendi (${action.type}).`,
  });
  return next;
}

export async function tryDispatch(taskId: string): Promise<Task> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();
  const task = await loadTask(taskId);
  // Onaysız dispatch yalnızca kapı durumunu hatırlatır — Cloud create yok
  const adapter = getCursorCloudAdapter();
  const result = await adapter.dispatch({
    taskId: task.id,
    agentId: task.assignee,
    projectSlug: task.projectSlug,
    title: task.title,
    description: task.description,
    priority: task.priority,
    // approvalId yok → awaiting_execution_approval
  });
  const prisma = getPrisma();
  await prisma.task.update({
    where: { id: task.id },
    data: { dispatchState: result.state },
  });
  await prisma.agentRun.create({
    data: {
      taskId: task.id,
      agentId: task.assignee,
      status: result.state,
      message: result.message,
      executionMode: "mock",
    },
  });
  return loadTask(taskId);
}

/**
 * Görevi başka projeye taşır. Geçmiş olaylar ve onay kayıtları silinmez;
 * bağlı onayların projectId'si tutarlılık için güncellenir.
 */
export async function reassignTaskProject(
  taskId: string,
  newProjectSlug: string,
  actor: Actor,
  note?: string,
): Promise<Task> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch açık: proje taşıma yok.");

  const prisma = getPrisma();
  const current = await loadTask(taskId);
  if (current.projectSlug === newProjectSlug) return current;

  const target = await prisma.project.findUnique({ where: { slug: newProjectSlug } });
  if (!target || target.status !== "active") {
    throw validationError("Hedef proje bulunamadı veya aktif değil.");
  }

  const fromProject = await prisma.project.findUnique({ where: { slug: current.projectSlug } });
  if (!fromProject) throw notFound("Mevcut proje bulunamadı.");

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: { projectId: target.id },
    });
    await tx.taskEvent.create({
      data: {
        taskId,
        actorKind: toActorKind(actor),
        actorAgent: actor.kind === "agent" ? actor.agentId : null,
        type: "project_changed",
        message:
          note ??
          `Proje değiştirildi: ${current.projectSlug} → ${newProjectSlug}. Geçmiş ve onaylar korundu.`,
        fromStatus: current.status,
        toStatus: current.status,
      },
    });
    // Aynı göreve bağlı onayların proje FK'sini güncelle (silme yok)
    await tx.approval.updateMany({
      where: { taskId },
      data: { projectId: target.id },
    });
  });

  await writeAudit({
    category: "task",
    action: "task.project_reassigned",
    actorKind: toActorKind(actor),
    actorAgent: actor.kind === "agent" ? actor.agentId : undefined,
    targetType: "task",
    targetId: taskId,
    summary: `Görev projesi taşındı: ${current.projectSlug} → ${newProjectSlug}`,
    metadata: {
      fromProjectSlug: current.projectSlug,
      toProjectSlug: newProjectSlug,
      fromProjectId: fromProject.id,
      toProjectId: target.id,
      approvalsUpdated: true,
      historyPreserved: true,
    },
  });

  return loadTask(taskId);
}
