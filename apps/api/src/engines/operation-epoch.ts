import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "./audit.js";

export const OPERATION_EPOCH_KEY = "operation_epoch";

export type OperationEpoch = {
  id: string;
  startedAt: string;
  previousId: string | null;
  note: string;
};

export async function readOperationEpoch(): Promise<OperationEpoch | null> {
  const row = await getPrisma().systemSetting.findUnique({ where: { key: OPERATION_EPOCH_KEY } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as OperationEpoch;
    if (!parsed.id || !parsed.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function startOperationEpoch(input: {
  id: string;
  note?: string;
  actor?: string;
}): Promise<OperationEpoch> {
  const current = await readOperationEpoch();
  const next: OperationEpoch = {
    id: input.id.trim() || `ops-${new Date().toISOString().slice(0, 10)}`,
    startedAt: new Date().toISOString(),
    previousId: current?.id ?? null,
    note: input.note ?? "Yeni operasyon dönemi — eski görevler silinmedi.",
  };
  await getPrisma().systemSetting.upsert({
    where: { key: OPERATION_EPOCH_KEY },
    create: { key: OPERATION_EPOCH_KEY, value: JSON.stringify(next), updatedBy: input.actor ?? "owner" },
    update: { value: JSON.stringify(next), updatedBy: input.actor ?? "owner", updatedAt: new Date() },
  });
  await writeAudit({
    category: "autonomy",
    action: "ops.epoch_started",
    actorKind: "user",
    summary: `Operasyon dönemi başladı: ${next.id}`,
    metadata: { ...next, realAiExecution: false },
  });
  return next;
}

export type EpochScope = "current" | "legacy" | "all";

export async function epochCreatedAtFilter(scope: EpochScope = "current"): Promise<Record<string, unknown>> {
  const epoch = await readOperationEpoch();
  if (!epoch || scope === "all") return {};
  const at = new Date(epoch.startedAt);
  if (scope === "legacy") return { createdAt: { lt: at } };
  return { createdAt: { gte: at } };
}

export async function countEpochTasks(epoch: OperationEpoch | null) {
  const prisma = getPrisma();
  const after = epoch ? new Date(epoch.startedAt) : null;
  const whereEpoch = after ? { createdAt: { gte: after }, archivedAt: null, source: "real" as const } : null;
  const [epochOpen, legacyOpen] = await Promise.all([
    whereEpoch
      ? prisma.task.count({
          where: {
            ...whereEpoch,
            status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
          },
        })
      : prisma.task.count({
          where: {
            archivedAt: null,
            source: "real",
            status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
          },
        }),
    after
      ? prisma.task.count({
          where: {
            archivedAt: null,
            source: "real",
            createdAt: { lt: after },
            status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
          },
        })
      : Promise.resolve(0),
  ]);
  return { epochOpen, legacyOpen, epochStartedAt: epoch?.startedAt ?? null, epochId: epoch?.id ?? null };
}
