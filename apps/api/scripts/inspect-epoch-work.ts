import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { readOperationEpoch } from "../src/engines/operation-epoch.js";
import { readOwnerGrants } from "../src/engines/owner-grants.js";

async function main() {
  const prisma = getPrisma();
  const epoch = await readOperationEpoch();
  const after = epoch?.startedAt ? new Date(epoch.startedAt) : new Date(0);
  const tasks = await prisma.task.findMany({
    where: { source: "real", createdAt: { gte: after } },
    include: { project: true },
    orderBy: { createdAt: "asc" },
  });
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  const jobs = await prisma.scheduledJob.findMany({
    select: { jobKey: true, lastFinishedAt: true, lastStatus: true, enabled: true },
  });
  const runs = await prisma.scheduledJobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      status: true,
      startedAt: true,
      finishedAt: true,
      message: true,
      job: { select: { jobKey: true } },
    },
  });
  const grants = await readOwnerGrants();
  const leases = await prisma.workerLease.findMany();
  const slim = tasks.map((t) => {
    const raw = t.executionResult ?? "";
    let exec: unknown = null;
    try {
      const p = JSON.parse(raw || "{}") as {
        acceptanceMet?: boolean;
        toolActions?: Array<{ kind?: string; path?: string | null; summary?: string }>;
        acceptanceVerification?: { reasons?: string[]; acceptanceMet?: boolean };
        realAiExecution?: boolean;
        work?: { findingKind?: string; draftKind?: string };
      };
      exec = {
        parseOk: true,
        rawLen: raw.length,
        rawHead: raw.slice(0, 160),
        acceptanceMet: p.acceptanceMet,
        kinds: (p.toolActions ?? []).map((a) => a.kind),
        paths: (p.toolActions ?? []).map((a) => a.path).filter(Boolean).slice(0, 8),
        reasons: p.acceptanceVerification?.reasons,
        realAi: p.realAiExecution,
        findingKind: p.work?.findingKind,
        draftKind: p.work?.draftKind,
      };
    } catch (err) {
      const kinds = [...raw.matchAll(/"kind":"([^"]+)"/g)].map((m) => m[1]);
      const paths = [...raw.matchAll(/"path":"([^"]+)"/g)].map((m) => m[1]).slice(0, 12);
      exec = {
        parseOk: false,
        rawLen: raw.length,
        rawHead: raw.slice(0, 200),
        error: err instanceof Error ? err.message : String(err),
        kindsTruncated: kinds,
        pathsTruncated: paths,
        hasPublicFetch: kinds.includes("public_fetch"),
        hasRepoRead: kinds.includes("repo_read"),
        hasBlocked: kinds.includes("blocked"),
      };
    }
    return {
      id: t.id.slice(0, 8),
      slug: t.project.slug,
      assignee: t.assigneeId,
      status: t.status,
      blocked: t.blockedReason,
      attempts: t.attempts,
      title: t.title.slice(0, 100),
      parent: Boolean(t.parentTaskId),
      exec,
    };
  });
  console.log(
    JSON.stringify(
      {
        epoch,
        grants,
        taskCount: tasks.length,
        acceptedChildren: slim.filter((s) => s.parent && s.status === "done").length,
        slim,
        leads: leads.map((l) => ({
          name: l.companyName,
          url: l.sourceUrl,
          verified: l.verified,
          need: l.needSignal?.slice(0, 120),
          project: l.projectSlug,
        })),
        jobs,
        runs,
        leases,
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
