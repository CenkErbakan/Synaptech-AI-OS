import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { writeAudit } from "../src/engines/audit.js";

async function main() {
  const prisma = getPrisma();
  const approved = await prisma.approval.findMany({
    where: { status: "approved", subjectKind: "task_escalation", taskId: { not: null } },
  });
  const ids = [...new Set(approved.map((a) => a.taskId!).filter(Boolean))];
  if (ids.length === 0) {
    console.log(JSON.stringify({ ok: true, resumed: 0 }));
    return;
  }
  const result = await prisma.task.updateMany({
    where: { id: { in: ids }, archivedAt: null, status: "awaiting_approval" },
    data: {
      status: "planned",
      dispatchState: "ready",
      workflowPhase: "ready",
      executionPolicy: "AUTO",
      blockedReason: null,
      attempts: 0,
      executionKind: "real_ai_pending",
      finishedAt: null,
    },
  });
  const stuck = await prisma.task.updateMany({
    where: {
      archivedAt: null,
      dispatchState: "running",
      status: "in_progress",
      updatedAt: { lt: new Date(Date.now() - 8 * 60_000) },
    },
    data: {
      status: "planned",
      dispatchState: "ready",
      workflowPhase: "ready",
      blockedReason: null,
    },
  });
  await writeAudit({
    category: "ops",
    action: "ops.local_escalation_resumed",
    actorKind: "owner",
    summary: `Owner onaylı yerel escalation kuyruğa alındı: ${result.count}`,
    metadata: { taskIds: ids, stuckReset: stuck.count, cloudStarted: false },
  });
  console.log(JSON.stringify({ ok: true, resumed: result.count, stuckReset: stuck.count, ids }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
