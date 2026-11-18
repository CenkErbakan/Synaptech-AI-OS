import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";

async function main() {
  const prisma = getPrisma();
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null, source: "real" },
    include: { project: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const approvals = await prisma.approval.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(
    JSON.stringify(
      {
        tasks: tasks.map((t) => ({
          title: t.title.slice(0, 80),
          status: t.status,
          dispatchState: t.dispatchState,
          blockedReason: t.blockedReason,
          executionPolicy: t.executionPolicy,
          executionKind: t.executionKind,
          attempts: t.attempts,
          assignee: t.assigneeId,
        })),
        approvals: approvals.map((a) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          subjectKind: a.subjectKind,
          title: a.title,
          taskId: a.taskId,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
