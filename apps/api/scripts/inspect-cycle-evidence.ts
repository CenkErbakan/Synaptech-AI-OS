import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { readOperationEpoch } from "../src/engines/operation-epoch.js";

function slim(result: string | null) {
  if (!result) return null;
  try {
    const j = JSON.parse(result) as Record<string, unknown>;
    return {
      acceptanceMet: j.acceptanceMet,
      codeChangeApplied: j.codeChangeApplied,
      realAiExecution: j.realAiExecution,
      agentId: j.agentId,
      modelId: j.modelId,
      evidenceUsed: j.evidenceUsed,
      toolActions: j.toolActions,
      acceptanceVerification: j.acceptanceVerification,
      workAcceptance: (j.work as { acceptanceNotes?: string; summary?: string } | undefined)?.acceptanceNotes,
      summary: (j.work as { summary?: string } | undefined)?.summary,
    };
  } catch {
    return { raw: result.slice(0, 400) };
  }
}

async function main() {
  const prisma = getPrisma();
  const epoch = await readOperationEpoch();
  const after = epoch ? new Date(epoch.startedAt) : new Date(0);
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null, createdAt: { gte: after } },
    include: { project: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(
    JSON.stringify(
      {
        epoch: epoch?.id,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title.slice(0, 90),
          project: t.project.slug,
          assignee: t.assigneeId,
          status: t.status,
          dispatchState: t.dispatchState,
          blockedReason: t.blockedReason,
          executionKind: t.executionKind,
          attempts: t.attempts,
          evidence: slim(t.executionResult),
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
