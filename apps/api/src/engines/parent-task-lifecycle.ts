import { getPrisma } from "../db/prisma.js";

const TERMINAL = new Set(["done", "failed", "awaiting_approval"]);

/** Child sonuçlarına göre CEO parent'ı kapat; done child yeniden açılmaz. */
export async function closeParentIfChildrenSettled(parentTaskId: string | null | undefined): Promise<{
  closed: boolean;
  status: string | null;
}> {
  if (!parentTaskId) return { closed: false, status: null };
  const prisma = getPrisma();
  const parent = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: { id: true, status: true, assigneeId: true, parentTaskId: true },
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

  const open = children.filter((c) => !TERMINAL.has(c.status));
  if (open.length > 0) return { closed: false, status: parent.status };

  const allDone = children.every((c) => c.status === "done");
  const anyFailed = children.some((c) => c.status === "failed");
  const nextStatus = allDone ? "done" : anyFailed ? "blocked" : "in_review";
  await prisma.task.update({
    where: { id: parent.id },
    data: {
      status: nextStatus,
      workflowPhase: allDone ? "completed" : anyFailed ? "failed" : "in_review",
      dispatchState: "not_applicable",
      finishedAt: allDone ? new Date() : null,
      blockedReason: allDone ? null : anyFailed ? "child_failed" : "children_not_all_accepted",
    },
  });
  return { closed: true, status: nextStatus };
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
