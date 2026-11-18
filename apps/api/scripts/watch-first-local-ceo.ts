import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { readOperationEpoch } from "../src/engines/operation-epoch.js";
import { getKillSwitch } from "../src/engines/kill-switch.js";
import { readOwnerGrants } from "../src/engines/owner-grants.js";

const started = Date.now();
const deadline = started + 240_000;

async function snapshot() {
  const prisma = getPrisma();
  const epoch = await readOperationEpoch();
  const after = epoch ? new Date(epoch.startedAt) : new Date(0);
  const [ceoAudits, ticks, tasks, messages, grants, kill] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: "ai.scheduler_ceo_cycle", at: { gte: after } },
      orderBy: { at: "desc" },
      take: 5,
    }),
    prisma.auditLog.findMany({
      where: { action: "scheduler.tick", at: { gte: new Date(started - 5_000) } },
      orderBy: { at: "desc" },
      take: 3,
    }),
    prisma.task.findMany({
      where: { archivedAt: null, createdAt: { gte: after } },
      select: {
        id: true,
        title: true,
        status: true,
        assigneeId: true,
        projectId: true,
        origin: true,
        parentTaskId: true,
        executionKind: true,
        model: true,
        blockedReason: true,
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.agentMessage.findMany({
      where: { createdAt: { gte: after } },
      select: { id: true, fromAgentId: true, toAgentId: true, kind: true, summary: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    readOwnerGrants(),
    getKillSwitch(),
  ]);
  return { epoch, ceoAudits, ticks, tasks, messages, grants, kill };
}

function realCeo(audits: Array<{ metadata: unknown; summary: string }>) {
  return audits.filter((a) => {
    const m = typeof a.metadata === "string" ? a.metadata : JSON.stringify(a.metadata ?? {});
    return m.includes('"realAiExecution":true');
  });
}

async function main() {
  while (Date.now() < deadline) {
    const snap = await snapshot();
    const real = realCeo(snap.ceoAudits);
    const tickTimer = snap.ticks.some((t) => JSON.stringify(t.metadata ?? "").includes('"trigger":"timer"'));
    if (real.length > 0) {
      console.log(JSON.stringify({ ok: true, waitedMs: Date.now() - started, tickTimer, ...summarize(snap) }, null, 2));
      return;
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  const snap = await snapshot();
  console.log(JSON.stringify({ ok: false, timeout: true, waitedMs: Date.now() - started, ...summarize(snap) }, null, 2));
  process.exitCode = 2;
}

function summarize(snap: Awaited<ReturnType<typeof snapshot>>) {
  return {
    epochId: snap.epoch?.id,
    killEnabled: snap.kill.enabled,
    grants: snap.grants,
    ceoSummaries: snap.ceoAudits.map((a) => ({ at: a.at, summary: a.summary, metadata: a.metadata })),
    tickSummaries: snap.ticks.map((a) => ({ at: a.at, summary: a.summary, metadata: a.metadata })),
    tasks: snap.tasks,
    messages: snap.messages,
  };
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
