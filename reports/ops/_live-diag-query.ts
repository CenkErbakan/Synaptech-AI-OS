/**
 * Salt okunur teşhis. Uygulama sürecine yazmaz.
 * Çalıştırma: apps/api cwd üzerinden tsx ile.
 */
import { disconnectPrisma, getPrisma } from "../../apps/api/src/db/prisma.js";
import { readOperationEpoch } from "../../apps/api/src/engines/operation-epoch.js";
import { readOwnerGrants } from "../../apps/api/src/engines/owner-grants.js";
import { getKillSwitch } from "../../apps/api/src/engines/kill-switch.js";
import { readDeferredLlmQueue } from "../../apps/api/src/engines/deferred-llm-queue.js";
import { listOwnerDecisionQueue } from "../../apps/api/src/engines/owner-decision-queue.js";
import { listProjectRepoBindings } from "../../apps/api/src/ai/repo/project-repo-registry.js";
import { isSelfPropertyUrl } from "../../apps/api/src/engines/growth-engine.js";

const AGENTS = [
  "ceo",
  "cto",
  "developer",
  "tester",
  "security",
  "growth-lead",
  "seo-specialist",
  "content-manager",
  "ads-manager",
] as const;

function slimExec(raw: string | null) {
  if (!raw) return { empty: true };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const toolActions = (p.toolActions as Array<{ kind?: string; path?: string }> | undefined) ?? [];
    const av = p.acceptanceVerification as { acceptanceMet?: boolean; reasons?: string[] } | undefined;
    return {
      parseOk: true,
      rawLen: raw.length,
      acceptanceMet: p.acceptanceMet ?? av?.acceptanceMet,
      realAi: p.realAiExecution,
      executionKind: p.executionKind,
      modelId: p.modelId,
      durationMs: p.durationMs,
      attempts: p.attempts,
      kinds: toolActions.map((a) => a.kind),
      paths: toolActions.map((a) => a.path).filter(Boolean).slice(0, 10),
      reasons: av?.reasons,
      executedAt: p.executedAt,
      findingKind: (p.work as { findingKind?: string } | undefined)?.findingKind,
      draftKind: (p.work as { draftKind?: string } | undefined)?.draftKind,
    };
  } catch {
    const kinds = [...raw.matchAll(/"kind":"([^"]+)"/g)].map((m) => m[1]);
    const paths = [...raw.matchAll(/"path":"([^"]+)"/g)].map((m) => m[1]).slice(0, 10);
    return {
      parseOk: false,
      rawLen: raw.length,
      truncated: raw.length >= 7900,
      kindsTruncated: [...new Set(kinds)],
      pathsTruncated: [...new Set(paths)],
      hasPublicFetch: kinds.includes("public_fetch"),
      hasRepoRead: kinds.includes("repo_read"),
      hasBlocked: kinds.includes("blocked"),
      head: raw.slice(0, 220),
    };
  }
}

function metaObj(metadata: string | null) {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return { unparsed: metadata.slice(0, 200) };
  }
}

async function main() {
  const prisma = getPrisma();
  const epoch = await readOperationEpoch();
  const after = epoch?.startedAt ? new Date(epoch.startedAt) : new Date(0);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    grants,
    kill,
    deferred,
    ownerQueue,
    bindings,
    jobs,
    jobRuns24h,
    ceoAudits24h,
    agentAudits24h,
    schemaAudits,
    tasks,
    messages,
    goals,
    opportunities,
    leads,
    leases,
    workers,
    drafts,
    seoFindings,
  ] = await Promise.all([
    readOwnerGrants(),
    getKillSwitch(),
    readDeferredLlmQueue(),
    listOwnerDecisionQueue(),
    listProjectRepoBindings(),
    prisma.scheduledJob.findMany(),
    prisma.scheduledJobRun.findMany({
      where: { startedAt: { gte: dayAgo } },
      orderBy: { startedAt: "desc" },
      take: 80,
      include: { job: { select: { jobKey: true, handler: true } } },
    }),
    prisma.auditLog.findMany({
      where: { action: "ai.scheduler_ceo_cycle", at: { gte: dayAgo } },
      orderBy: { at: "desc" },
      take: 40,
    }),
    prisma.auditLog.findMany({
      where: { action: "ai.local_agent_execution", at: { gte: dayAgo } },
      orderBy: { at: "desc" },
      take: 60,
    }),
    prisma.auditLog.findMany({
      where: {
        at: { gte: dayAgo },
        OR: [
          { action: { contains: "json" } },
          { summary: { contains: "JSON" } },
          { action: "autonomy.controlled_tick" },
        ],
      },
      orderBy: { at: "desc" },
      take: 30,
    }),
    prisma.task.findMany({
      where: { source: "real", createdAt: { gte: after } },
      include: { project: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agentMessage.findMany({
      where: { createdAt: { gte: after } },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.companyGoal.findMany({ where: { status: "active" } }),
    prisma.opportunity.findMany({ take: 30, orderBy: { createdAt: "desc" } }),
    prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.workerLease.findMany(),
    prisma.workerInstance.findMany({ orderBy: { lastSeenAt: "desc" }, take: 8 }),
    prisma.contentDraftRecord.count().catch(() => -1),
    prisma.seoFinding.count().catch(() => -1),
  ]);

  const statusCount: Record<string, number> = {};
  for (const t of tasks) statusCount[t.status] = (statusCount[t.status] ?? 0) + 1;

  const byAgent: Record<string, unknown> = {};
  for (const a of AGENTS) {
    const assigned = tasks.filter((t) => t.assigneeId === a);
    const audits = agentAudits24h.filter((x) => x.actorAgent === a);
    const realOk = audits.filter((x) => {
      const m = metaObj(x.metadata);
      return m.realAiExecution === true && m.failed !== true && !String(x.summary).includes("başarısız");
    });
    const realFail = audits.filter((x) => {
      const m = metaObj(x.metadata);
      return m.failed === true || String(x.summary).includes("başarısız");
    });
    const last = assigned.sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())[0];
    byAgent[a] = {
      epochAssigned: assigned.length,
      active: assigned.filter((t) =>
        ["planned", "in_progress", "testing", "in_review", "awaiting_approval"].includes(t.status),
      ).length,
      planned: assigned.filter((t) => t.status === "planned").length,
      done: assigned.filter((t) => t.status === "done").length,
      failed: assigned.filter((t) => t.status === "failed").length,
      awaiting: assigned.filter((t) => t.status === "awaiting_approval").length,
      audits24h: audits.length,
      realOk24h: realOk.length,
      realFail24h: realFail.length,
      lastTask: last
        ? {
            id: last.id,
            status: last.status,
            title: last.title.slice(0, 80),
            blocked: last.blockedReason,
            attempts: last.attempts,
            executionKind: last.executionKind,
            updatedAt: last.updatedAt.toISOString(),
            exec: slimExec(last.executionResult),
          }
        : null,
    };
  }

  const stuck = tasks
    .filter((t) => t.parentTaskId)
    .filter(
      (t) =>
        t.status === "planned" ||
        t.status === "in_progress" ||
        t.status === "awaiting_approval" ||
        Boolean(t.blockedReason),
    )
    .map((t) => ({
      taskId: t.id,
      assignedAgent: t.assigneeId,
      status: t.status,
      lastAttemptAt: t.startedAt?.toISOString() ?? t.updatedAt.toISOString(),
      attempts: t.attempts,
      reason: t.blockedReason,
      dispatchState: t.dispatchState,
      executionKind: t.executionKind,
      nextEligibleAt: null as string | null,
      title: t.title.slice(0, 100),
      project: t.project.slug,
    }));

  const ceoCycles = ceoAudits24h.map((a) => {
    const m = metaObj(a.metadata);
    return {
      at: a.at.toISOString(),
      summary: a.summary,
      realAiExecution: m.realAiExecution === true,
      durationMs: (m.durationMs ??
        (m.extra as { durationMs?: number } | undefined)?.durationMs) as number | undefined,
      modelId: (m.extra as { modelId?: string } | undefined)?.modelId ?? m.modelId,
      jsonValid: (m.extra as { jsonValid?: boolean } | undefined)?.jsonValid,
      childCount: (m.extra as { childCount?: number } | undefined)?.childCount,
      grounding: (m.extra as { grounding?: unknown } | undefined)?.grounding,
      skippedReason: m.skippedReason,
      extra: m.extra ?? null,
    };
  });

  const parentCeo = tasks.filter((t) => !t.parentTaskId && t.assigneeId === "ceo");
  const children = tasks.filter((t) => t.parentTaskId);

  const oldestPending = tasks
    .filter((t) => t.parentTaskId && ["planned", "in_progress", "backlog"].includes(t.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  const projectRows = ["synaptech-ai-os", "synaptech", "subify", "marivo"].map((slug) => {
    const pt = tasks.filter((t) => t.project.slug === slug);
    const pg = goals.filter((g) => g.projectSlug === slug);
    const last = [...pt].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return {
      slug,
      goals: pg.map((g) => ({
        key: g.goalKey,
        title: g.title,
        dataSource: g.dataSource,
        current: g.currentValue,
        target: g.targetValue,
      })),
      epochTasks: pt.length,
      active: pt.filter((t) =>
        ["planned", "in_progress", "testing", "in_review", "awaiting_approval"].includes(t.status),
      ).length,
      lastTask: last
        ? { id: last.id, assignee: last.assigneeId, status: last.status, title: last.title.slice(0, 80), at: last.updatedAt.toISOString() }
        : null,
    };
  });

  console.log(
    JSON.stringify(
      {
        queriedAt: new Date().toISOString(),
        epoch,
        grants,
        kill: { enabled: kill.enabled, source: kill.source, reason: kill.reason },
        deferred,
        ownerPending: ownerQueue.pendingCount,
        ownerItems: ownerQueue.items.slice(0, 15).map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          status: i.status,
        })),
        bindings: bindings.map((b) => ({
          slug: b.projectSlug,
          verified: b.verified,
          verifiedBy: b.verifiedBy,
          source: b.source,
          blockedReason: b.blockedReason,
          hasLocalRoot: Boolean(b.localReadRoot),
          hasGithub: Boolean(b.githubRepoUrl),
          readOnly: b.readOnly,
          writeAllowed: b.writeAllowed,
        })),
        jobs: jobs.map((j) => ({
          jobKey: j.jobKey,
          cronExpr: j.cronExpr,
          enabled: j.enabled,
          lastStatus: j.lastStatus,
          lastFinishedAt: j.lastFinishedAt?.toISOString() ?? null,
          lastError: j.lastError,
        })),
        jobRuns24h: jobRuns24h.map((r) => ({
          jobKey: r.job.jobKey,
          handler: r.job.handler,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          message: r.message,
          resultHead: r.resultJson?.slice(0, 400) ?? null,
        })),
        ceoCycles,
        agentAudits24h: agentAudits24h.map((a) => ({
          at: a.at.toISOString(),
          agent: a.actorAgent,
          summary: a.summary.slice(0, 240),
          meta: metaObj(a.metadata),
          targetId: a.targetId,
        })),
        schemaAudits: schemaAudits.map((a) => ({
          at: a.at.toISOString(),
          action: a.action,
          summary: a.summary.slice(0, 240),
        })),
        taskInventory: {
          total: tasks.length,
          parents: parentCeo.length,
          children: children.length,
          statusCount,
          oldestPending: oldestPending
            ? {
                id: oldestPending.id,
                assignee: oldestPending.assigneeId,
                status: oldestPending.status,
                createdAt: oldestPending.createdAt.toISOString(),
                title: oldestPending.title,
              }
            : null,
        },
        tasks: tasks.map((t) => ({
          id: t.id,
          slug: t.project.slug,
          assignee: t.assigneeId,
          status: t.status,
          parent: Boolean(t.parentTaskId),
          origin: t.origin,
          blocked: t.blockedReason,
          attempts: t.attempts,
          dispatchState: t.dispatchState,
          executionKind: t.executionKind,
          executionPolicy: t.executionPolicy,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
          startedAt: t.startedAt?.toISOString() ?? null,
          finishedAt: t.finishedAt?.toISOString() ?? null,
          title: t.title,
          idempotencyKey: t.idempotencyKey,
          exec: slimExec(t.executionResult),
        })),
        messages: messages.map((m) => ({
          id: m.id,
          from: m.fromAgentId,
          to: m.toAgentId,
          kind: m.kind,
          taskId: m.taskId,
          at: m.createdAt.toISOString(),
          summary: m.summary.slice(0, 200),
        })),
        byAgent,
        stuck,
        projectRows,
        goals: goals.map((g) => ({
          key: g.goalKey,
          slug: g.projectSlug,
          title: g.title,
          dataSource: g.dataSource,
        })),
        opportunities: opportunities.map((o) => ({
          id: o.id,
          slug: o.projectSlug,
          title: o.title,
          status: o.status,
          verified: o.verified,
          suggestedAgentId: o.suggestedAgentId,
        })),
        leads: leads.map((l) => ({
          id: l.id,
          name: l.companyName,
          url: l.sourceUrl ?? l.websiteUrl,
          verified: l.verified,
          sourceKind: l.sourceKind,
          self: isSelfPropertyUrl(l.sourceUrl ?? l.websiteUrl ?? ""),
          need: l.needSignal?.slice(0, 120),
          project: l.projectSlug,
          createdAt: l.createdAt.toISOString(),
        })),
        leases,
        workers,
        drafts,
        seoFindings,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
