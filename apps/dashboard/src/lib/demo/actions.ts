import {
  ApprovalError,
  TaskSchema,
  TaskTransitionError,
  applyTaskAction,
  createTask,
  decideApproval,
  recordSubjectVersion,
  type ActivityEvent,
  type NewTaskInput,
  type TaskAction,
} from "@synaptech/shared";
import { DEMO_DATASET_VERSION, type DemoDataset } from "@synaptech/shared/demo";

export interface DemoOptions {
  now: Date;
  killSwitchEnabled: boolean;
  maxRetries: number;
  newId: () => string;
}

export type DemoResult =
  | { ok: true; dataset: DemoDataset; message: string }
  | { ok: false; error: string };

function failure(error: unknown): DemoResult {
  if (error instanceof TaskTransitionError || error instanceof ApprovalError) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: `Beklenmeyen hata: ${(error as Error).message}` };
}

function demoEvent(options: DemoOptions, event: Omit<ActivityEvent, "id" | "source" | "at">): ActivityEvent {
  return { ...event, id: `demo-${options.newId()}`, source: "demo", at: options.now.toISOString() };
}

export function demoCreateTask(dataset: DemoDataset, input: NewTaskInput, options: DemoOptions): DemoResult {
  try {
    const task = createTask(input, {
      actor: { kind: "user" },
      now: options.now,
      killSwitchEnabled: options.killSwitchEnabled,
      maxRetries: options.maxRetries,
      newId: options.newId,
      source: "demo",
    });
    const numbered = { ...task, id: `T-D${dataset.tasks.length + 1}` };
    return {
      ok: true,
      dataset: { ...dataset, tasks: [numbered, ...dataset.tasks] },
      message: `DEMO görev oluşturuldu: ${numbered.title}`,
    };
  } catch (error) {
    return failure(error);
  }
}

export function demoApplyTaskAction(
  dataset: DemoDataset,
  taskId: string,
  action: TaskAction,
  options: DemoOptions,
): DemoResult {
  const task = dataset.tasks.find((item) => item.id === taskId);
  if (!task) return { ok: false, error: "Görev bulunamadı." };
  try {
    const updated = applyTaskAction(task, action, {
      actor: { kind: "user" },
      now: options.now,
      killSwitchEnabled: options.killSwitchEnabled,
      maxRetries: options.maxRetries,
      newId: options.newId,
    });
    return {
      ok: true,
      dataset: { ...dataset, tasks: dataset.tasks.map((item) => (item.id === taskId ? updated : item)) },
      message: updated.history.at(-1)?.message ?? "Görev güncellendi.",
    };
  } catch (error) {
    return failure(error);
  }
}

export function demoDecideApproval(
  dataset: DemoDataset,
  approvalId: string,
  decision: "approved" | "rejected",
  note: string | undefined,
  options: DemoOptions,
): DemoResult {
  const request = dataset.approvals.find((item) => item.id === approvalId);
  if (!request) return { ok: false, error: "Onay talebi bulunamadı." };

  try {
    const decided = decideApproval(request, decision, {
      actor: { kind: "user" },
      now: options.now,
      killSwitchEnabled: options.killSwitchEnabled,
      note: note?.trim() || undefined,
    });

    let tasks = dataset.tasks;
    const linked = tasks.find((task) => task.id === request.taskId);
    if (decision === "rejected" && linked?.status === "awaiting_approval") {
      const returned = applyTaskAction(
        linked,
        { type: "advance", to: "in_review", note: "Kullanıcı reddetti; yeniden düzenlenecek." },
        {
          actor: { kind: "system" },
          now: options.now,
          killSwitchEnabled: options.killSwitchEnabled,
          maxRetries: options.maxRetries,
          newId: options.newId,
        },
      );
      tasks = tasks.map((task) => (task.id === linked.id ? returned : task));
    }

    const event = demoEvent(options, {
      kind: "approval",
      severity: "info",
      actorLabel: "Kullanıcı",
      title: decision === "approved" ? "Kullanıcı onayladı" : "Kullanıcı reddetti",
      detail: request.title,
      projectSlug: request.projectSlug,
      taskId: request.taskId,
    });

    return {
      ok: true,
      dataset: {
        ...dataset,
        tasks,
        approvals: dataset.approvals.map((item) => (item.id === approvalId ? decided : item)),
        activity: [event, ...dataset.activity],
      },
      message:
        decision === "approved"
          ? "Onay kaydedildi. İşlemi ajan değil, Faz 3'teki güvenilir yürütücü yapacak."
          : "Talep reddedildi; görev incelemeye döndü.",
    };
  } catch (error) {
    return failure(error);
  }
}

/** DEMO: bağlı içeriğe yeni bir sürüm geldiğini canlandırır; onaylı talep geçersiz olur. */
export function demoSimulateNewVersion(dataset: DemoDataset, approvalId: string, options: DemoOptions): DemoResult {
  const request = dataset.approvals.find((item) => item.id === approvalId);
  if (!request) return { ok: false, error: "Onay talebi bulunamadı." };

  const prefix = request.subject.version.split(":")[0] ?? "sha";
  const version = `${prefix}:${options.newId().replace(/[^a-z0-9]/gi, "").padEnd(20, "0").slice(0, 20)}`;
  const updated = recordSubjectVersion(request, version);
  const event = demoEvent(options, {
    kind: "approval",
    severity: "warning",
    actorLabel: "Sistem",
    title: "Yeni sürüm geldi (DEMO simülasyonu)",
    detail: `${request.title}: bağlı sürüm değiştiği için önceki onay geçerli değil.`,
    projectSlug: request.projectSlug,
    taskId: request.taskId,
  });

  return {
    ok: true,
    dataset: {
      ...dataset,
      approvals: dataset.approvals.map((item) => (item.id === approvalId ? updated : item)),
      activity: [event, ...dataset.activity],
    },
    message: "Yeni sürüm kaydedildi; onay geçersiz hâle geldi.",
  };
}

export function isValidDemoDataset(value: unknown): value is DemoDataset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DemoDataset>;
  return (
    candidate.version === DEMO_DATASET_VERSION &&
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.approvals) &&
    Array.isArray(candidate.activity) &&
    typeof candidate.growth === "object" &&
    Array.isArray(candidate.projectDetails) &&
    candidate.tasks.every((task) => TaskSchema.safeParse(task).success && task.source === "demo")
  );
}
