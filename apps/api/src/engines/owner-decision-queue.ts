import { getPrisma } from "../db/prisma.js";
import { listApprovals } from "./approval-engine.js";
import { OWNER_GATED_ACTIONS } from "./autonomy-policy-gate.js";

export type OwnerDecisionItem = {
  id: string;
  kind: "approval_request" | "task_awaiting_approval";
  title: string;
  projectSlug: string | null;
  type: string;
  createdAt: string;
  hrefHint: string;
};

/** Dashboard tek karar kuyruğu — onay kaydı + awaiting_approval görevler. */
export async function listOwnerDecisionQueue(): Promise<{
  source: "api";
  ownerGatedActions: readonly string[];
  pendingCount: number;
  items: OwnerDecisionItem[];
}> {
  const prisma = getPrisma();
  const { epochCreatedAtFilter, readOperationEpoch } = await import("./operation-epoch.js");
  const epoch = await readOperationEpoch();
  const epochFilter = await epochCreatedAtFilter("current");
  const [approvals, tasks] = await Promise.all([
    listApprovals(),
    prisma.task.findMany({
      where: { archivedAt: null, source: "real", status: "awaiting_approval", ...epochFilter },
      include: { project: { select: { slug: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);

  const items: OwnerDecisionItem[] = [];

  const epochStart = epoch ? new Date(epoch.startedAt).getTime() : 0;
  for (const a of approvals) {
    if (a.effectiveStatus !== "pending") continue;
    if (epochStart && new Date(a.createdAt).getTime() < epochStart) continue;
    items.push({
      id: a.id,
      kind: "approval_request",
      title: a.title,
      projectSlug: a.projectSlug,
      type: a.type,
      createdAt: a.createdAt,
      hrefHint: "/onaylar",
    });
  }

  for (const t of tasks) {
    items.push({
      id: t.id,
      kind: "task_awaiting_approval",
      title: t.title,
      projectSlug: t.project.slug,
      type: t.blockedReason ?? "awaiting_approval",
      createdAt: t.createdAt.toISOString(),
      hrefHint: "/gorevler",
    });
  }

  items.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));

  return {
    source: "api",
    ownerGatedActions: OWNER_GATED_ACTIONS,
    pendingCount: items.length,
    items,
  };
}
