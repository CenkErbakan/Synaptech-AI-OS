import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";

/** Escalation onayı attempts sıfırlayıp otomatik yeniden çalıştırmaz. */
async function main() {
  const prisma = getPrisma();
  const approved = await prisma.approval.findMany({
    where: { status: "approved", subjectKind: "task_escalation", taskId: { not: null } },
    select: { taskId: true },
  });
  const ids = [...new Set(approved.map((a) => a.taskId!).filter(Boolean))];
  console.log(
    JSON.stringify({
      ok: true,
      resumed: 0,
      note: "Otomatik resume kapalı. retryBudget>0 Owner kararı gerekir. attempts sıfırlanmaz.",
      approvedEscalationTaskIds: ids,
    }),
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
