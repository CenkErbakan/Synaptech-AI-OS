import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "./audit.js";

const TERMINAL = new Set(["done", "failed", "awaiting_approval", "blocked", "cancelled"]);

export function classifyParentFromChildren(
  children: Array<{ status: string }>,
): { status: string; blockedReason: string | null; workflowPhase: string; finished: boolean } {
  if (children.length === 0) {
    return { status: "planned", blockedReason: null, workflowPhase: "ready", finished: false };
  }
  const open = children.filter((c) => !TERMINAL.has(c.status));
  if (open.length > 0) {
    return { status: "in_review", blockedReason: "children_in_flight", workflowPhase: "in_review", finished: false };
  }
  const allDone = children.every((c) => c.status === "done");
  if (allDone) {
    return { status: "done", blockedReason: null, workflowPhase: "completed", finished: true };
  }
  const waitingOwner = children.some((c) => c.status === "awaiting_approval");
  if (waitingOwner) {
    return {
      status: "in_review",
      blockedReason: "waiting_owner_decision",
      workflowPhase: "in_review",
      finished: false,
    };
  }
  return {
    status: "blocked",
    blockedReason: "partial_child_failure",
    workflowPhase: "failed",
    finished: false,
  };
}

/** Child sonuçlarına göre CEO parent'ı kapat; done child yeniden açılmaz. */
export async function closeParentIfChildrenSettled(parentTaskId: string | null | undefined): Promise<{
  closed: boolean;
  status: string | null;
}> {
  if (!parentTaskId) return { closed: false, status: null };
  const prisma = getPrisma();
  const parent = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: { id: true, status: true, assigneeId: true, parentTaskId: true, blockedReason: true },
  });
  if (!parent || parent.parentTaskId) return { closed: false, status: parent?.status ?? null };
  if (parent.status === "done" || parent.status === "failed") {
    return { closed: false, status: parent.status };
  }

  const children = await prisma.task.findMany({
    where: { parentTaskId: parent.id, archivedAt: null, source: "real" },
    select: { status: true, blockedReason: true },
  });
  if (children.length === 0) return { closed: false, status: parent.status };

  const next = classifyParentFromChildren(children);
  if (next.status === parent.status && next.blockedReason === (parent.blockedReason ?? null)) {
    return { closed: next.status === "done", status: parent.status };
  }

  await prisma.task.update({
    where: { id: parent.id },
    data: {
      status: next.status,
      workflowPhase: next.workflowPhase,
      dispatchState: "not_applicable",
      finishedAt: next.finished ? new Date() : null,
      blockedReason: next.blockedReason,
    },
  });
  await writeAudit({
    category: "autonomy",
    action: "task.parent_state",
    actorKind: "system",
    targetType: "task",
    targetId: parent.id,
    summary: `CEO parent ${parent.status} → ${next.status} (${next.blockedReason ?? "ok"})`,
    metadata: {
      from: parent.status,
      to: next.status,
      blockedReason: next.blockedReason,
      childStatuses: children.map((c) => c.status),
    },
  });
  return { closed: next.status === "done", status: next.status };
}

/** Epoch içindeki açık CEO parent'larını child sonuçlarıyla kapat. */
export async function closeSettledCeoParents(limit = 20): Promise<number> {
  const prisma = getPrisma();
  const parents = await prisma.task.findMany({
    where: {
      parentTaskId: null,
      archivedAt: null,
      origin: { startsWith: "scheduler-ai-ceo:" },
      status: { notIn: ["done", "failed"] },
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  let n = 0;
  for (const p of parents) {
    const r = await closeParentIfChildrenSettled(p.id);
    if (r.closed) n += 1;
  }
  return n;
}
