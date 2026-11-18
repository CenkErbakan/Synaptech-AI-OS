import { createHash } from "node:crypto";
import { disconnectPrisma, getPrisma } from "../../apps/api/src/db/prisma.js";
import { getEnv } from "../../apps/api/src/lib/env.js";

function clip(s: string | null | undefined, n = 240) {
  if (!s) return s ?? null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function parseJson(s: string | null | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return { _parseError: true, preview: clip(s, 180) };
  }
}

async function main() {
  const prisma = getPrisma();
  const since30 = new Date(Date.now() - 30 * 60_000);
  const ceoSince = new Date("2026-11-18T19:00:00.000Z");

  const parents = await prisma.task.findMany({
    where: {
      parentTaskId: null,
      assigneeId: "ceo",
      createdAt: { gte: ceoSince },
    },
    include: {
      project: { select: { slug: true } },
      children: {
        include: { project: { select: { slug: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const targetParent =
    parents.find((p) => (p.origin ?? "").includes("c6f7d85f")) ??
    parents.find((p) => p.children.length === 3) ??
    parents.at(-1) ??
    null;

  const childIds = targetParent?.children.map((c) => c.id) ?? [];
  const allTaskIds = targetParent ? [targetParent.id, ...childIds] : [];

  const [messages, events, runs, audits30, ceoAudits, agentAudits, jobs, jobRuns, leases, settings, leads, seo, scans] =
    await Promise.all([
      allTaskIds.length
        ? prisma.agentMessage.findMany({
            where: { OR: [{ taskId: { in: allTaskIds } }, { parentTaskId: targetParent!.id }] },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),
      childIds.length
        ? prisma.taskEvent.findMany({ where: { taskId: { in: childIds } }, orderBy: { at: "asc" } })
        : Promise.resolve([]),
      childIds.length
        ? prisma.agentRun.findMany({ where: { taskId: { in: childIds } }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
      prisma.auditLog.findMany({ where: { at: { gte: since30 } }, orderBy: { at: "desc" }, take: 200 }),
      prisma.auditLog.findMany({
        where: {
          at: { gte: ceoSince },
          OR: [{ action: { contains: "ceo" } }, { action: { contains: "local_llm" } }, { action: { contains: "local_agent" } }],
        },
        orderBy: { at: "asc" },
        take: 120,
      }),
      prisma.auditLog.findMany({
        where: { at: { gte: ceoSince }, action: "ai.local_agent_execution" },
        orderBy: { at: "asc" },
        take: 80,
      }),
      prisma.scheduledJob.findMany({
        select: { jobKey: true, enabled: true, lastStatus: true, lastStartedAt: true, lastFinishedAt: true, timeoutSec: true },
      }),
      prisma.scheduledJobRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          message: true,
          startedAt: true,
          finishedAt: true,
          idempotencyKey: true,
          resultJson: true,
        },
      }),
      prisma.workerLease.findMany({
        select: { lockKey: true, holderId: true, expiresAt: true, heartbeatAt: true },
      }),
      prisma.systemSetting.findMany({
        where: { key: { in: ["owner_grants", "ceo_provider_circuit", "operation_epoch", "kill_switch"] } },
      }),
      prisma.lead.findMany({ where: { createdAt: { gte: ceoSince } }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.seoFinding.findMany({ where: { createdAt: { gte: ceoSince } }, orderBy: { createdAt: "desc" }, take: 40 }),
      prisma.growthScanRun.findMany({ where: { startedAt: { gte: ceoSince } }, orderBy: { startedAt: "desc" }, take: 15 }),
    ]);

  const laterCeoParents = parents.filter((p) => targetParent && p.createdAt > targetParent.createdAt);

  const childReports = (targetParent?.children ?? []).map((c) => {
    const exec = parseJson(c.executionResult);
    const msgs = messages.filter((m) => m.taskId === c.id);
    const evidenceMsg = msgs.find((m) => m.kind === "evidence");
    const evidencePayload = parseJson(evidenceMsg?.payloadJson);
    const storedSha = evidenceMsg?.evidenceRef?.replace(/^sha256:/, "") ?? exec?.evidenceSha256 ?? null;
    const recomputed = evidenceMsg?.payloadJson
      ? createHash("sha256").update(evidenceMsg.payloadJson).digest("hex")
      : null;
    const toolActions = Array.isArray(evidencePayload?.toolActions) ? evidencePayload.toolActions : [];
    const relatedAudits = [...agentAudits, ...ceoAudits].filter(
      (a) => a.targetId === c.id || (a.metadata && a.metadata.includes(c.id)),
    );
    return {
      id: c.id,
      title: c.title,
      project: c.project.slug,
      assigneeId: c.assigneeId,
      status: c.status,
      dispatchState: c.dispatchState,
      workflowPhase: c.workflowPhase,
      attempts: c.attempts,
      blockedReason: c.blockedReason,
      executionKind: c.executionKind,
      model: c.model,
      origin: c.origin,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      startedAt: c.startedAt?.toISOString() ?? null,
      finishedAt: c.finishedAt?.toISOString() ?? null,
      compactResult: exec,
      evidenceShaStored: storedSha,
      evidenceShaRecomputed: recomputed,
      evidenceHashMatch: storedSha && recomputed ? storedSha === recomputed : null,
      verifier: evidencePayload?.acceptanceVerification ?? exec?.reasons ?? null,
      acceptanceMet: exec?.acceptanceMet ?? evidencePayload?.acceptanceVerification?.acceptanceMet ?? null,
      findingKind: evidencePayload?.work?.findingKind ?? evidencePayload?.modelProposal?.findingKind ?? null,
      toolActions,
      workSummary: evidencePayload?.work?.summary ?? null,
      recommendations: evidencePayload?.work?.recommendations ?? null,
      messageKinds: msgs.map((m) => ({
        id: m.id,
        kind: m.kind,
        from: m.fromAgentId,
        to: m.toAgentId,
        at: m.createdAt.toISOString(),
        summary: clip(m.summary, 200),
        evidenceRef: m.evidenceRef,
      })),
      events: events
        .filter((e) => e.taskId === c.id)
        .map((e) => ({
          at: e.at.toISOString(),
          type: e.type,
          message: clip(e.message, 160),
          from: e.fromStatus,
          to: e.toStatus,
        })),
      agentRuns: runs
        .filter((r) => r.taskId === c.id)
        .map((r) => ({
          id: r.id,
          status: r.status,
          executionMode: r.executionMode,
          model: r.model,
          message: clip(r.message, 160),
        })),
      audits: relatedAudits.map((a) => ({
        at: a.at.toISOString(),
        action: a.action,
        actorAgent: a.actorAgent,
        summary: clip(a.summary, 180),
        metadata: parseJson(a.metadata),
      })),
    };
  });

  const llmRelated = audits30.filter((a) => {
    const act = `${a.action} ${a.summary} ${a.metadata ?? ""}`.toLowerCase();
    return (
      act.includes("llm") ||
      act.includes("ollama") ||
      act.includes("local_agent") ||
      act.includes("ai.ceo") ||
      act.includes("provider") ||
      act.includes("local_llm")
    );
  });

  const durations = llmRelated.map((a) => {
    const md = parseJson(a.metadata) as { durationMs?: number; extra?: { durationMs?: number }; failed?: boolean } | null;
    const durationMs = md?.durationMs ?? md?.extra?.durationMs ?? null;
    const failed = Boolean(md?.failed || /başarısız|timeout|invalid_json|failed/i.test(a.summary));
    return {
      at: a.at.toISOString(),
      action: a.action,
      actor: a.actorAgent,
      durationMs,
      failed,
      summary: clip(a.summary, 160),
    };
  });

  const grantRow = settings.find((s) => s.key === "owner_grants");
  const circuitRow = settings.find((s) => s.key === "ceo_provider_circuit");

  const env = getEnv();
  const auth = { Authorization: `Bearer ${env.SYNAPTECH_OWNER_TOKEN}` };
  const apiGet = async (path: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:3101${path}`, { headers: auth });
      const text = await res.text();
      return { status: res.status, body: parseJson(text) ?? clip(text, 400) };
    } catch (e) {
      return { status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const [health, scheduler, workers, grantsApi, localRuntime, execStatus, repoTools, aiStatus] = await Promise.all([
    apiGet("/api/system/health"),
    apiGet("/api/system/scheduler"),
    apiGet("/api/system/workers"),
    apiGet("/api/ops/grants"),
    apiGet("/api/ops/local-runtime"),
    apiGet("/api/ai/agents/execution-status"),
    apiGet("/api/ai/agents/repo-tools-status"),
    apiGet("/api/ai/status"),
  ]);

  const out = {
    now: new Date().toISOString(),
    parent: targetParent
      ? {
          id: targetParent.id,
          title: targetParent.title,
          status: targetParent.status,
          dispatchState: targetParent.dispatchState,
          blockedReason: targetParent.blockedReason,
          origin: targetParent.origin,
          model: targetParent.model,
          createdAt: targetParent.createdAt.toISOString(),
          updatedAt: targetParent.updatedAt.toISOString(),
          finishedAt: targetParent.finishedAt?.toISOString() ?? null,
          executionKind: targetParent.executionKind,
          childCount: targetParent.children.length,
        }
      : null,
    laterCeoParents: laterCeoParents.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      origin: p.origin,
      status: p.status,
      childCount: p.children.length,
    })),
    allCeoParentsSince1900: parents.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      origin: clip(p.origin, 140),
      status: p.status,
      children: p.children.map((c) => c.assigneeId),
    })),
    children: childReports,
    parentMessages: messages
      .filter((m) => m.taskId === targetParent?.id)
      .map((m) => ({
        kind: m.kind,
        from: m.fromAgentId,
        to: m.toAgentId,
        at: m.createdAt.toISOString(),
        summary: clip(m.summary, 180),
      })),
    jobs,
    jobRuns: jobRuns.map((r) => ({
      id: r.id,
      status: r.status,
      message: clip(r.message, 220),
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      idempotencyKey: r.idempotencyKey,
      result: parseJson(r.resultJson),
    })),
    leases: leases.map((l) => ({
      lockKey: l.lockKey,
      holderId: l.holderId,
      expiresAt: l.expiresAt.toISOString(),
      heartbeatAt: l.heartbeatAt.toISOString(),
      expired: l.expiresAt.getTime() < Date.now(),
    })),
    grants: parseJson(grantRow?.value),
    circuit: parseJson(circuitRow?.value),
    leadsSinceCeo: leads.map((l) => ({
      id: l.id,
      companyName: l.companyName,
      websiteUrl: l.websiteUrl,
      sourceUrl: l.sourceUrl,
      sourceKind: l.sourceKind,
      verified: l.verified,
      projectSlug: l.projectSlug,
      createdAt: l.createdAt.toISOString(),
      needSignal: clip(l.needSignal, 160),
    })),
    seoSinceCeo: seo.map((s) => ({
      id: s.id,
      projectSlug: s.projectSlug,
      pageUrl: s.pageUrl,
      category: s.category,
      findingKind: s.findingKind,
      title: s.title,
      httpStatus: s.httpStatus,
      createdAt: s.createdAt.toISOString(),
      evidenceRef: s.evidenceRef,
    })),
    scansSinceCeo: scans.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      summary: clip(s.summary, 180),
      startedAt: s.startedAt.toISOString(),
      errorMessage: s.errorMessage,
    })),
    last30mLlmAudits: durations,
    last30mAuditActions: audits30.reduce<Record<string, number>>((acc, a) => {
      acc[a.action] = (acc[a.action] ?? 0) + 1;
      return acc;
    }, {}),
    agentExecAuditsSinceCeo: agentAudits.map((a) => ({
      at: a.at.toISOString(),
      actor: a.actorAgent,
      targetId: a.targetId,
      summary: clip(a.summary, 200),
      metadata: parseJson(a.metadata),
    })),
    api: {
      health,
      scheduler,
      workers,
      grantsApi,
      localRuntime: {
        status: localRuntime.status,
        body:
          localRuntime.body && typeof localRuntime.body === "object"
            ? {
                ...(localRuntime.body as Record<string, unknown>),
                envFileKeys: "[omitted]",
              }
            : localRuntime.body,
      },
      execStatus,
      repoTools,
      aiStatus,
    },
    ceoRelatedAudits: ceoAudits.map((a) => ({
      at: a.at.toISOString(),
      action: a.action,
      actor: a.actorAgent,
      targetId: a.targetId,
      summary: clip(a.summary, 180),
      metadata: parseJson(a.metadata),
    })),
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
