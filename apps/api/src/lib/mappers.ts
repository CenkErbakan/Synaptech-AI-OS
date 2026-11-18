import type {
  Actor,
  AgentId,
  ApprovalRequest,
  DispatchState,
  Priority,
  Task,
  TaskEvent,
  TaskStatus,
} from "@synaptech/shared";
import type {
  Approval as DbApproval,
  Task as DbTask,
  TaskEvent as DbTaskEvent,
} from "@prisma/client";

export function mapActor(kind: string, agentId?: string | null): Actor {
  if (kind === "agent" && agentId) return { kind: "agent", agentId: agentId as AgentId };
  if (kind === "system") return { kind: "system" };
  return { kind: "user" };
}

export function mapTaskEvent(event: DbTaskEvent): TaskEvent {
  return {
    id: event.id,
    at: event.at.toISOString(),
    actor: mapActor(event.actorKind, event.actorAgent),
    type: event.type as TaskEvent["type"],
    message: event.message,
    fromStatus: (event.fromStatus as TaskStatus | null) ?? undefined,
    toStatus: (event.toStatus as TaskStatus | null) ?? undefined,
  };
}

export function mapTask(task: DbTask & { events?: DbTaskEvent[]; project?: { slug: string } }): Task {
  const projectSlug = task.project?.slug ?? "synaptech";
  return {
    id: task.id,
    source: "api",
    title: task.title,
    description: task.description,
    projectSlug,
    assignee: task.assigneeId as Task["assignee"],
    priority: task.priority as Priority,
    status: task.status as TaskStatus,
    paused: task.paused,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    startedAt: task.startedAt?.toISOString(),
    finishedAt: task.finishedAt?.toISOString(),
    attempts: task.attempts,
    timeoutMinutes: task.timeoutMinutes,
    dueAt: task.dueAt?.toISOString(),
    dispatchState: task.dispatchState as DispatchState,
    idempotencyKey: task.idempotencyKey ?? undefined,
    approvalId: task.approvalId ?? undefined,
    model: task.model ?? undefined,
    git: task.gitBranch || task.gitPrUrl ? { branch: task.gitBranch ?? undefined, prUrl: task.gitPrUrl ?? undefined } : undefined,
    history: (task.events ?? []).map(mapTaskEvent),
    archivedAt: task.archivedAt?.toISOString() ?? null,
    archivedReason: task.archivedReason ?? null,
  };
}

/** Aktif panoda gösterilecek görevler */
export const ACTIVE_TASK_WHERE = { archivedAt: null } as const;

export function mapApproval(row: DbApproval): ApprovalRequest {
  return {
    id: row.id,
    source: "api",
    type: row.type as ApprovalRequest["type"],
    requestedBy: row.requestedBy as ApprovalRequest["requestedBy"],
    projectSlug: "", // route layer fills from project
    taskId: row.taskId ?? undefined,
    title: row.title,
    description: row.description,
    changeSummary: row.changeSummary,
    risk: row.risk as ApprovalRequest["risk"],
    subject: {
      kind: row.subjectKind as ApprovalRequest["subject"]["kind"],
      ref: row.subjectRef,
      version: row.subjectVersion,
    },
    currentVersion: row.currentVersion,
    status: (row.status === "invalidated"
      ? "approved"
      : row.status === "expired"
        ? "pending"
        : row.status) as ApprovalRequest["status"],
    decision:
      row.decidedAt && row.boundVersion && (row.status === "approved" || row.status === "rejected" || row.status === "invalidated")
        ? {
            by: "user",
            at: row.decidedAt.toISOString(),
            decision: row.status === "rejected" ? "rejected" : "approved",
            note: row.decisionNote ?? undefined,
            boundVersion: row.boundVersion,
          }
        : undefined,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString(),
    executor: "trusted-executor",
  };
}
