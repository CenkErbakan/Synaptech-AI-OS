import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { readOwnerGrants } from "../src/engines/owner-grants.js";
import { getKillSwitch } from "../src/engines/kill-switch.js";
import { countEpochTasks, readOperationEpoch } from "../src/engines/operation-epoch.js";
import { githubWriteStatus } from "../src/engines/github-rest.js";
import { getEnv } from "../src/lib/env.js";

async function main() {
  const prisma = getPrisma();
  const epoch = await readOperationEpoch();
  const after = new Date(epoch!.startedAt);
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null, createdAt: { gte: after } },
    include: { project: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const messages = await prisma.agentMessage.findMany({
    where: { createdAt: { gte: after } },
    select: { fromAgentId: true, toAgentId: true, kind: true, summary: true, taskId: true },
    orderBy: { createdAt: "asc" },
  });
  const agentAudits = await prisma.auditLog.findMany({
    where: { action: { in: ["ai.local_agent_execution", "ai.scheduler_ceo_cycle", "autonomy.controlled_tick"] }, at: { gte: after } },
    orderBy: { at: "asc" },
    select: { action: true, at: true, summary: true, actorAgent: true },
  });
  const zombie = await prisma.scheduledJobRun.updateMany({
    where: { status: "running", startedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "failed", finishedAt: new Date(), message: "Owner restart: process killed; stale run closed." },
  });
  console.log(
    JSON.stringify(
      {
        epoch: epoch?.id,
        counts: await countEpochTasks(epoch),
        grants: await readOwnerGrants(),
        kill: (await getKillSwitch()).enabled,
        github: githubWriteStatus(),
        modes: {
          ceo: getEnv().SCHEDULER_AI_CEO_MODE,
          agent: getEnv().LOCAL_AGENT_EXECUTION_MODE,
          controlled: getEnv().CONTROLLED_AUTONOMY_MODE,
          github: getEnv().GITHUB_WRITE_MODE,
          email: getEnv().EMAIL_OUTREACH_MODE,
        },
        zombiesClosed: zombie.count,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          project: t.project.slug,
          assignee: t.assigneeId,
          status: t.status,
          parent: t.parentTaskId,
          model: t.model,
          blockedReason: t.blockedReason,
          executionKind: t.executionKind,
        })),
        messages,
        agentAudits,
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
