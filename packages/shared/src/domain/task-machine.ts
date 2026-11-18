import type { AgentId } from "./agents";
import type { DataSource } from "./source";
import {
  DEFAULT_TASK_TIMEOUT_MINUTES,
  NewTaskInputSchema,
  TASK_STATUS_LABELS,
  isActiveStatus,
  type Actor,
  type NewTaskInput,
  type Task,
  type TaskEvent,
  type TaskStatus,
} from "./tasks";

export type TaskErrorCode =
  | "kill_switch"
  | "invalid_transition"
  | "forbidden_actor"
  | "retry_limit"
  | "paused"
  | "validation";

export class TaskTransitionError extends Error {
  readonly code: TaskErrorCode;

  constructor(code: TaskErrorCode, message: string) {
    super(message);
    this.name = "TaskTransitionError";
    this.code = code;
  }
}

export interface TaskContext {
  actor: Actor;
  now: Date;
  killSwitchEnabled: boolean;
  maxRetries: number;
  newId: () => string;
}

export type TaskAction =
  | { type: "plan" }
  | { type: "unplan" }
  | { type: "pause"; reason?: string }
  | { type: "resume" }
  | { type: "cancel"; reason?: string }
  | { type: "restart" }
  | { type: "advance"; to: TaskStatus; assignee?: AgentId; note?: string };

export type UserTaskActionType = "plan" | "unplan" | "pause" | "resume" | "cancel" | "restart";

export const USER_TASK_ACTION_LABELS: Record<UserTaskActionType, string> = {
  plan: "Planla",
  unplan: "Backlog'a al",
  pause: "Durdur",
  resume: "Devam ettir",
  cancel: "İptal et",
  restart: "Yeniden başlat",
};

/** config/permissions.yaml içindeki task.create aktörleriyle aynıdır. */
export const TASK_CREATOR_AGENTS: readonly AgentId[] = ["ceo", "cto", "growth-lead"];

const AGENT_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  backlog: [],
  planned: ["in_progress"],
  in_progress: ["testing", "in_review", "awaiting_approval", "failed"],
  testing: ["in_progress", "in_review", "failed"],
  in_review: ["in_progress", "awaiting_approval", "done", "failed"],
  awaiting_approval: [],
  done: [],
  failed: [],
  cancelled: [],
};

/** Onay bekleyen görevi yalnızca sistem (Faz 3: güvenilir yürütücü) ilerletebilir. */
const SYSTEM_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  ...AGENT_TRANSITIONS,
  awaiting_approval: ["done", "in_review", "failed"],
};

function fail(code: TaskErrorCode, message: string): never {
  throw new TaskTransitionError(code, message);
}

function isTaskCreator(actor: Actor): boolean {
  return (
    actor.kind === "user" ||
    actor.kind === "system" ||
    (actor.kind === "agent" && TASK_CREATOR_AGENTS.includes(actor.agentId))
  );
}

function requireActor(actor: Actor, allowed: ReadonlyArray<Actor["kind"]>, what: string): void {
  if (!allowed.includes(actor.kind)) {
    fail("forbidden_actor", `${what} işlemini bu aktör yapamaz.`);
  }
}

function withEvent(
  task: Task,
  patch: Partial<Task>,
  ctx: TaskContext,
  event: Omit<TaskEvent, "id" | "at" | "actor">,
): Task {
  const at = ctx.now.toISOString();
  return {
    ...task,
    ...patch,
    updatedAt: at,
    history: [...task.history, { ...event, id: ctx.newId(), at, actor: ctx.actor }],
  };
}

export function createTask(input: NewTaskInput, ctx: TaskContext & { source: DataSource }): Task {
  if (ctx.killSwitchEnabled) {
    fail("kill_switch", "Kill switch açık: yeni görev oluşturulamaz.");
  }
  if (!isTaskCreator(ctx.actor)) {
    fail("forbidden_actor", "Bu ajan görev oluşturamaz.");
  }

  const parsed = NewTaskInputSchema.safeParse(input);
  if (!parsed.success) {
    fail("validation", parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const data = parsed.data;
  const at = ctx.now.toISOString();

  const dispatchState = data.dispatchState ?? "not_applicable";
  return {
    id: ctx.newId(),
    source: ctx.source,
    title: data.title,
    description: data.description,
    projectSlug: data.projectSlug,
    assignee: data.assignee,
    priority: data.priority,
    status: data.initialStatus,
    paused: false,
    createdAt: at,
    updatedAt: at,
    attempts: 0,
    timeoutMinutes: data.timeoutMinutes ?? DEFAULT_TASK_TIMEOUT_MINUTES,
    dueAt: data.dueAt,
    dispatchState,
    idempotencyKey: data.idempotencyKey,
    history: [
      {
        id: ctx.newId(),
        at,
        actor: ctx.actor,
        type: "created",
        message: `Görev oluşturuldu (${TASK_STATUS_LABELS[data.initialStatus]}).`,
        toStatus: data.initialStatus,
      },
    ],
  };
}

export function allowedUserActions(
  task: Task,
  options: { killSwitchEnabled: boolean; maxRetries: number },
): UserTaskActionType[] {
  const actions: UserTaskActionType[] = [];
  if (task.status === "backlog") actions.push("plan");
  if (task.status === "planned") actions.push("unplan");
  if (isActiveStatus(task.status) && !task.paused) actions.push("pause");
  if (task.paused && !options.killSwitchEnabled) actions.push("resume");
  if (task.status !== "done" && task.status !== "cancelled") actions.push("cancel");
  if (
    (task.status === "failed" || task.status === "cancelled") &&
    task.attempts < options.maxRetries &&
    !options.killSwitchEnabled
  ) {
    actions.push("restart");
  }
  return actions;
}

export function applyTaskAction(task: Task, action: TaskAction, ctx: TaskContext): Task {
  switch (action.type) {
    case "plan": {
      if (!isTaskCreator(ctx.actor)) fail("forbidden_actor", "Bu ajan görevi planlayamaz.");
      if (task.status !== "backlog") fail("invalid_transition", "Yalnızca backlog'daki görev planlanabilir.");
      return withEvent(task, { status: "planned" }, ctx, {
        type: "planned",
        message: "Görev planlandı.",
        fromStatus: task.status,
        toStatus: "planned",
      });
    }

    case "unplan": {
      if (!isTaskCreator(ctx.actor)) fail("forbidden_actor", "Bu ajan görevi backlog'a alamaz.");
      if (task.status !== "planned") fail("invalid_transition", "Yalnızca planlanmış görev backlog'a alınabilir.");
      return withEvent(task, { status: "backlog" }, ctx, {
        type: "unplanned",
        message: "Görev backlog'a alındı.",
        fromStatus: task.status,
        toStatus: "backlog",
      });
    }

    case "pause": {
      requireActor(ctx.actor, ["user", "system"], "Durdurma");
      if (!isActiveStatus(task.status)) fail("invalid_transition", "Yalnızca çalışan, test edilen veya incelenen görev durdurulabilir.");
      if (task.paused) fail("invalid_transition", "Görev zaten durdurulmuş.");
      return withEvent(task, { paused: true }, ctx, {
        type: "paused",
        message: action.reason ? `Görev durduruldu: ${action.reason}` : "Görev durduruldu.",
      });
    }

    case "resume": {
      requireActor(ctx.actor, ["user", "system"], "Devam ettirme");
      if (ctx.killSwitchEnabled) fail("kill_switch", "Kill switch açık: görev devam ettirilemez.");
      if (!task.paused) fail("invalid_transition", "Görev durdurulmuş değil.");
      return withEvent(task, { paused: false }, ctx, {
        type: "resumed",
        message: "Görev devam ettirildi.",
      });
    }

    case "cancel": {
      requireActor(ctx.actor, ["user", "system"], "İptal");
      if (task.status === "done" || task.status === "cancelled") {
        fail("invalid_transition", "Tamamlanmış veya iptal edilmiş görev iptal edilemez.");
      }
      return withEvent(
        task,
        { status: "cancelled", paused: false, finishedAt: ctx.now.toISOString() },
        ctx,
        {
          type: "cancelled",
          message: action.reason ? `Görev iptal edildi: ${action.reason}` : "Görev iptal edildi.",
          fromStatus: task.status,
          toStatus: "cancelled",
        },
      );
    }

    case "restart": {
      requireActor(ctx.actor, ["user"], "Yeniden başlatma");
      if (ctx.killSwitchEnabled) fail("kill_switch", "Kill switch açık: görev yeniden başlatılamaz.");
      if (task.status !== "failed" && task.status !== "cancelled") {
        fail("invalid_transition", "Yalnızca başarısız veya iptal edilmiş görev yeniden başlatılabilir.");
      }
      if (task.attempts >= ctx.maxRetries) {
        fail("retry_limit", `Yeniden deneme sınırına ulaşıldı (${ctx.maxRetries}).`);
      }
      const attempts = task.attempts + 1;
      return withEvent(
        task,
        { status: "planned", paused: false, attempts, startedAt: undefined, finishedAt: undefined },
        ctx,
        {
          type: "restarted",
          message: `Görev yeniden başlatıldı (deneme ${attempts}/${ctx.maxRetries}).`,
          fromStatus: task.status,
          toStatus: "planned",
        },
      );
    }

    case "advance": {
      requireActor(ctx.actor, ["agent", "system"], "Durum ilerletme");
      if (ctx.actor.kind === "agent" && ctx.actor.agentId !== task.assignee) {
        fail("forbidden_actor", "Görevi yalnızca sorumlu ajan ilerletebilir.");
      }
      if (task.paused) fail("paused", "Görev durdurulmuş; önce kullanıcı devam ettirmeli.");
      if (ctx.killSwitchEnabled && action.to === "in_progress") {
        fail("kill_switch", "Kill switch açık: görev çalıştırılamaz.");
      }
      const table = ctx.actor.kind === "system" ? SYSTEM_TRANSITIONS : AGENT_TRANSITIONS;
      if (!table[task.status].includes(action.to)) {
        fail(
          "invalid_transition",
          `${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS[action.to]} geçişine izin yok.`,
        );
      }
      const at = ctx.now.toISOString();
      const patch: Partial<Task> = { status: action.to };
      if (action.to === "in_progress" && !task.startedAt) patch.startedAt = at;
      if (action.to === "done" || action.to === "failed") patch.finishedAt = at;
      if (action.assignee) patch.assignee = action.assignee;
      const base = `Durum değişti: ${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS[action.to]}.`;
      return withEvent(task, patch, ctx, {
        type: "status_changed",
        message: action.note ? `${base} ${action.note}` : base,
        fromStatus: task.status,
        toStatus: action.to,
      });
    }
  }
}

export function isTaskTimedOut(task: Task, now: Date): boolean {
  if (!isActiveStatus(task.status) || task.paused || !task.startedAt) return false;
  const elapsedMinutes = (now.getTime() - new Date(task.startedAt).getTime()) / 60_000;
  return elapsedMinutes > task.timeoutMinutes;
}
