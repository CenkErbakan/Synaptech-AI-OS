import { randomUUID } from "node:crypto";

import { runScheduledAiCeoCycle } from "../src/ai/ai-ceo-scheduler.js";
import { LOCAL_LLM_CALL_LEASE_KEY } from "../src/ai/llm-call-guard.js";
import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";

/** En fazla bir kontrollü CEO planı. Timer tetiklemez. */
async function main() {
  const prisma = getPrisma();
  const now = new Date();
  const lease = await prisma.workerLease.findUnique({ where: { lockKey: LOCAL_LLM_CALL_LEASE_KEY } });
  if (lease && lease.expiresAt > now) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "llm_lease_held",
        holderId: lease.holderId,
        expiresAt: lease.expiresAt.toISOString(),
      }),
    );
    return;
  }
  const running = await prisma.scheduledJobRun.findFirst({
    where: {
      status: "running",
      idempotencyKey: { startsWith: "daily-ceo-review:" },
      startedAt: { gt: new Date(now.getTime() - 12 * 60_000) },
    },
    orderBy: { startedAt: "desc" },
    select: { idempotencyKey: true, startedAt: true },
  });
  if (running) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "ceo_job_running",
        idempotencyKey: running.idempotencyKey,
        startedAt: running.startedAt.toISOString(),
      }),
    );
    return;
  }

  const result = await runScheduledAiCeoCycle({
    idempotencySuffix: randomUUID(),
    ignoreCircuit: true,
  });
  const leaseAfter = await prisma.workerLease.findUnique({ where: { lockKey: LOCAL_LLM_CALL_LEASE_KEY } });
  const evidence = result.plan
    ? {
        projectAllocation: result.plan.tasks.reduce<Record<string, number>>((acc, t) => {
          acc[t.projectSlug] = (acc[t.projectSlug] ?? 0) + 1;
          return acc;
        }, {}),
        assignees: result.plan.tasks.map((t) => t.assigneeId),
      }
    : null;
  console.log(
    JSON.stringify(
      {
        skipped: false,
        skippedReason: result.skippedReason ?? null,
        providerInvoked: result.realAiExecution || result.jsonValid != null,
        realAiExecution: result.realAiExecution,
        modelId: result.modelId,
        durationMs: result.durationMs,
        jsonValid: result.jsonValid,
        parentTaskId: result.parentTaskId,
        newTaskCount: result.childTaskIds.length + (result.parentTaskId ? 1 : 0),
        childTaskIds: result.childTaskIds,
        agentMessageCount: result.messageIds.length,
        grounding: result.grounding,
        projectAllocation: evidence?.projectAllocation ?? null,
        assignees: evidence?.assignees ?? null,
        leaseReleased: !leaseAfter || leaseAfter.expiresAt <= new Date(),
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
