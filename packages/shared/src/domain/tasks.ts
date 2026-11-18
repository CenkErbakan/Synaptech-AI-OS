import { z } from "zod";

import { AgentIdSchema, type AgentId } from "./agents";
import { DataSourceSchema } from "./source";

export const TASK_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "testing",
  "in_review",
  "awaiting_approval",
  "done",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

/** Kanban panosundaki 8 sütun; iptal edilen görevler ayrı bir anahtarla gösterilir. */
export const BOARD_COLUMNS = [
  "backlog",
  "planned",
  "in_progress",
  "testing",
  "in_review",
  "awaiting_approval",
  "done",
  "failed",
] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  planned: "Planlandı",
  in_progress: "Çalışıyor",
  testing: "Test Ediliyor",
  in_review: "İncelemede",
  awaiting_approval: "Onay Bekliyor",
  done: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal Edildi",
};

export const ACTIVE_TASK_STATUSES = [
  "in_progress",
  "testing",
  "in_review",
] as const satisfies readonly TaskStatus[];

export function isActiveStatus(status: TaskStatus): boolean {
  return (ACTIVE_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PrioritySchema = z.enum(PRIORITIES);

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

export const DEFAULT_TASK_TIMEOUT_MINUTES = 60;
export const DEFAULT_MAX_RETRIES = 2;

/** Faz 3: Cursor/executor bağlantısı olmadan gerçek ajan çalıştırılmaz. */
export const DISPATCH_STATES = [
  "not_applicable",
  "awaiting_integration",
  "awaiting_execution_approval",
  "ready",
  "dispatched",
  "unavailable",
  "reconciliation_required",
  "failed",
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];
export const DispatchStateSchema = z.enum(DISPATCH_STATES);

export const DISPATCH_STATE_LABELS: Record<DispatchState, string> = {
  not_applicable: "Dağıtım yok",
  awaiting_integration: "Planlandı — Cursor bağlantısı bekleniyor",
  awaiting_execution_approval: "Owner Cloud yürütme onayı bekleniyor",
  ready: "Dağıtıma hazır",
  dispatched: "Cursor'a gönderildi",
  unavailable: "Entegrasyon bekleniyor",
  reconciliation_required: "Uzlaştırma gerekli",
  failed: "Dağıtım başarısız",
};

export const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), agentId: AgentIdSchema }),
  z.object({ kind: z.literal("system") }),
]);

export type Actor = z.infer<typeof ActorSchema>;

export function actorLabel(actor: Actor, agentNames?: Partial<Record<AgentId, string>>): string {
  switch (actor.kind) {
    case "user":
      return "Kullanıcı";
    case "system":
      return "Sistem";
    case "agent":
      return agentNames?.[actor.agentId] ?? actor.agentId;
  }
}

export const TASK_EVENT_TYPES = [
  "created",
  "planned",
  "unplanned",
  "status_changed",
  "paused",
  "resumed",
  "cancelled",
  "restarted",
  "project_changed",
] as const;

export const TaskEventSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  actor: ActorSchema,
  type: z.enum(TASK_EVENT_TYPES),
  message: z.string(),
  fromStatus: TaskStatusSchema.optional(),
  toStatus: TaskStatusSchema.optional(),
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;

export const TaskTestResultSchema = z.object({
  status: z.enum(["passed", "failed", "not_run"]),
  summary: z.string(),
  at: z.string().optional(),
});

export type TaskTestResult = z.infer<typeof TaskTestResultSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  source: DataSourceSchema,
  title: z.string().min(1),
  description: z.string(),
  projectSlug: z.string().min(1),
  assignee: AgentIdSchema,
  priority: PrioritySchema,
  status: TaskStatusSchema,
  paused: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  attempts: z.number().int().min(0),
  timeoutMinutes: z.number().int().positive(),
  tests: TaskTestResultSchema.optional(),
  git: z
    .object({
      branch: z.string().optional(),
      prUrl: z.string().optional(),
    })
    .optional(),
  model: z.string().optional(),
  approvalId: z.string().optional(),
  dueAt: z.string().optional(),
  dispatchState: DispatchStateSchema.default("not_applicable"),
  idempotencyKey: z.string().optional(),
  history: z.array(TaskEventSchema),
  archivedAt: z.string().nullable().optional(),
  archivedReason: z.string().nullable().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const NewTaskInputSchema = z.object({
  title: z.string().trim().min(3, "Başlık en az 3 karakter olmalı.").max(140, "Başlık en fazla 140 karakter olabilir."),
  description: z.string().trim().max(2000, "Açıklama en fazla 2000 karakter olabilir.").default(""),
  projectSlug: z.string().min(1, "Proje seçilmeli."),
  assignee: AgentIdSchema,
  priority: PrioritySchema.default("medium"),
  initialStatus: z.enum(["backlog", "planned"]).default("backlog"),
  timeoutMinutes: z.number().int().positive().max(24 * 60).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  dispatchState: DispatchStateSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type NewTaskInput = z.input<typeof NewTaskInputSchema>;

/** Dashboard CEO formu — her zaman CEO'ya atanır, Cursor bekler. */
export const CeoTaskSubmissionSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(2000).default(""),
  projectSlug: z.string().min(1),
  priority: PrioritySchema.default("medium"),
  dueAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type CeoTaskSubmission = z.input<typeof CeoTaskSubmissionSchema>;
