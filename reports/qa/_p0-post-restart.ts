import { disconnectPrisma, getPrisma } from "../../apps/api/src/db/prisma.js";
import { getEnv } from "../../apps/api/src/lib/env.js";
import { readOwnerGrants } from "../../apps/api/src/engines/owner-grants.js";
import { listGrantRuntimeMismatches } from "../../apps/api/src/engines/grant-runtime-alignment.js";

async function main() {
  const prisma = getPrisma();
  const env = getEnv();
  const grants = await readOwnerGrants();
  const ids = [
    "ffd9dea3-4ed3-454b-b008-94bb3e3d9f02",
    "935d6b6e-4964-4761-8f0a-d72dc3af8a7d",
    "79648c69-821d-4613-a795-9498bed95dfe",
    "6999d63a-7db9-462a-930f-430735c4f826",
  ];
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids } },
    include: { project: { select: { slug: true } } },
  });
  const parents = await prisma.task.findMany({
    where: {
      parentTaskId: null,
      assigneeId: "ceo",
      origin: { startsWith: "scheduler-ai-ceo:ops-2026-11-18" },
    },
    select: { id: true, status: true, blockedReason: true, createdAt: true, origin: true },
    orderBy: { createdAt: "asc" },
  });
  const lead = await prisma.lead.findUnique({
    where: { id: "1f4213de-3c5a-4af9-bef2-801694cb10ff" },
  });
  const pendingReady = await prisma.task.count({
    where: {
      archivedAt: null,
      source: "real",
      parentTaskId: { not: null },
      status: { in: ["planned", "in_progress", "backlog"] },
      dispatchState: { in: ["ready", "not_applicable"] },
    },
  });
  const auth = { Authorization: `Bearer ${env.SYNAPTECH_OWNER_TOKEN}` };
  const health = await fetch("http://127.0.0.1:3101/api/system/health").then((r) => r.json());
  const exec = await fetch("http://127.0.0.1:3101/api/ai/agents/execution-status", { headers: auth }).then((r) =>
    r.json(),
  );
  const grantsApi = await fetch("http://127.0.0.1:3101/api/ops/grants", { headers: auth }).then((r) => r.json());
  console.log(
    JSON.stringify(
      {
        health,
        exec: {
          pendingReady: exec.pendingReady,
          completedLocalLlm: exec.completedLocalLlm,
          timerActive: exec.timerActive,
          mode: exec.mode,
        },
        pendingReadyDb: pendingReady,
        grants,
        grantsApi: grantsApi.values,
        mismatches: listGrantRuntimeMismatches({
          grants,
          githubWriteMode: env.GITHUB_WRITE_MODE,
          cloudLiveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
        }),
        tasks: tasks.map((t) => ({
          id: t.id,
          slug: t.project.slug,
          assignee: t.assigneeId,
          status: t.status,
          dispatch: t.dispatchState,
          attempts: t.attempts,
          blockedReason: t.blockedReason,
          policy: t.executionPolicy,
        })),
        lead: lead
          ? { projectSlug: lead.projectSlug, companyName: lead.companyName, verified: lead.verified, notes: lead.notes }
          : null,
        ceoParents: parents.map((p) => ({
          id: p.id.slice(0, 8),
          status: p.status,
          blockedReason: p.blockedReason,
          at: p.createdAt.toISOString(),
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
