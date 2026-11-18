import { disconnectPrisma, getPrisma } from "../../apps/api/src/db/prisma.js";
import { getEnv } from "../../apps/api/src/lib/env.js";
import { readOwnerGrants } from "../../apps/api/src/engines/owner-grants.js";
import { parseOwnerRetryRemaining } from "../../apps/api/src/ai/retry-budget.js";
import { classifyCtoContract, claimsActiveDefect } from "../../apps/api/src/ai/cto-finding.js";
import { normalizeTitleKey } from "../../apps/api/src/ai/plan-grounding.js";

const NEW_API = new Date("2026-11-18T19:38:21.000Z");
const STORM_AFTER = new Date("2026-11-18T19:16:00.000Z");
const FIRST_GOOD = "ffd9dea3-4ed3-454b-b008-94bb3e3d9f02";

function parseJson(s: string | null | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function clip(s: string | null | undefined, n = 160) {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function contradiction(status: string, dispatch: string): string | null {
  if (status === "done" && dispatch === "ready") return "done_but_ready";
  if (status === "awaiting_approval" && dispatch === "ready") return "awaiting_but_ready";
  if (status === "planned" && dispatch === "blocked") return "planned_but_blocked";
  if (status === "in_progress" && dispatch === "not_applicable") return "in_progress_not_applicable";
  if (status === "failed" && dispatch === "ready") return "failed_but_ready";
  return null;
}

async function main() {
  const prisma = getPrisma();
  const env = getEnv();
  const epochRow = await prisma.systemSetting.findUnique({ where: { key: "operation_epoch" } });
  const epoch = parseJson(epochRow?.value) as { id?: string; startedAt?: string } | null;
  const after = epoch?.startedAt ? new Date(epoch.startedAt) : new Date("2026-11-18T00:00:00Z");
  const since15 = new Date(Date.now() - 15 * 60_000);

  const tasks = await prisma.task.findMany({
    where: {
      source: "real",
      archivedAt: null,
      createdAt: { gte: after },
      OR: [{ origin: { startsWith: "scheduler-ai-ceo:" } }, { parentTaskId: { not: null } }, { assigneeId: "ceo" }],
    },
    include: { project: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });

  const ids = tasks.map((t) => t.id);
  const [messages, audits15, ceoAudits, leases, grants] = await Promise.all([
    prisma.agentMessage.findMany({
      where: { OR: [{ taskId: { in: ids } }, { parentTaskId: { in: ids } }] },
      orderBy: { createdAt: "asc" },
      select: {
        taskId: true,
        parentTaskId: true,
        kind: true,
        fromAgentId: true,
        createdAt: true,
        evidenceRef: true,
        summary: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { at: { gte: since15 }, action: { in: ["ai.local_agent_execution", "ai.scheduler_ceo_cycle", "task.parent_state"] } },
      orderBy: { at: "desc" },
      take: 80,
      select: { at: true, action: true, targetId: true, summary: true, metadata: true, actorAgent: true },
    }),
    prisma.auditLog.findMany({
      where: { action: "ai.scheduler_ceo_cycle", at: { gte: after } },
      orderBy: { at: "asc" },
      select: { at: true, summary: true, targetId: true, metadata: true },
    }),
    prisma.workerLease.findMany(),
    readOwnerGrants(),
  ]);

  const auth = { Authorization: `Bearer ${env.SYNAPTECH_OWNER_TOKEN}` };
  const [health, exec, scheduler] = await Promise.all([
    fetch("http://127.0.0.1:3101/api/system/health").then((r) => r.json()),
    fetch("http://127.0.0.1:3101/api/ai/agents/execution-status", { headers: auth }).then((r) => r.json()),
    fetch("http://127.0.0.1:3101/api/system/scheduler", { headers: auth }).then((r) => r.json()),
  ]);

  const parents = tasks.filter((t) => !t.parentTaskId && t.assigneeId === "ceo");
  const children = tasks.filter((t) => t.parentTaskId);

  const titleGroups = new Map<string, typeof children>();
  const workGroups = new Map<string, typeof children>();
  for (const c of children) {
    const tk = `${c.project.slug}:${normalizeTitleKey(c.title)}`;
    const wk = `${c.project.slug}:${c.assigneeId}`;
    if (!titleGroups.has(tk)) titleGroups.set(tk, []);
    titleGroups.get(tk)!.push(c);
    if (!["done", "failed", "cancelled"].includes(c.status)) {
      if (!workGroups.has(wk)) workGroups.set(wk, []);
      workGroups.get(wk)!.push(c);
    }
  }

  const classified = children.map((c) => {
    const execRes = parseJson(c.executionResult);
    const evidenceMsgs = messages.filter((m) => m.taskId === c.id && m.kind === "evidence");
    const resultMsgs = messages.filter((m) => m.taskId === c.id && (m.kind === "result" || m.kind === "failure"));
    const providerCalls = evidenceMsgs.filter((m) => m.fromAgentId === c.assigneeId).length;
    const retryBudget = parseOwnerRetryRemaining(c.executionPolicy);
    const contra = contradiction(c.status, c.dispatchState);
    const storm = c.createdAt >= STORM_AFTER && c.parentTaskId !== FIRST_GOOD;
    const original = c.parentTaskId === FIRST_GOOD;
    const acceptanceMet = execRes?.acceptanceMet ?? null;
    const tk = `${c.project.slug}:${normalizeTitleKey(c.title)}`;
    const titleDups = (titleGroups.get(tk) ?? []).filter((x) => x.id !== c.id);
    const openTitleDup = titleDups.some((x) => !["done", "failed", "cancelled"].includes(x.status) || x.status === "done");
    const earlierSameTitle = titleDups.filter((x) => x.createdAt < c.createdAt);
    const wk = `${c.project.slug}:${c.assigneeId}`;
    const workDups = (workGroups.get(wk) ?? []).filter((x) => x.id !== c.id);
    const isLaterDup =
      earlierSameTitle.length > 0 ||
      (workDups.some((x) => x.createdAt < c.createdAt) &&
        !["done", "failed", "cancelled"].includes(c.status) &&
        c.assigneeId !== "tester");

    let category = "EXECUTABLE";
    let why = "planned/ready ve açık";
    if (c.status === "done" && acceptanceMet === true) {
      category = "DONE";
      why = "status=done ve acceptanceMet=true";
    } else if (c.status === "done") {
      category = "DONE";
      why = "status=done (acceptanceMet kaydı yok/false)";
    } else if (c.status === "awaiting_approval" || c.blockedReason === "retry_budget_exhausted") {
      category = "OWNER_DECISION";
      why = c.blockedReason ?? "awaiting_approval";
    } else if (c.status === "failed" || c.blockedReason === "no_finding_inconclusive") {
      category = "ACCEPTANCE_BLOCKED";
      why = c.blockedReason ?? "failed";
    } else if (contra) {
      category = "STALE_OR_INCONSISTENT";
      why = contra;
    } else if (isLaterDup && c.status !== "done") {
      category = "DUPLICATE";
      why = earlierSameTitle.length
        ? `aynı başlık daha önce: ${earlierSameTitle[0]!.id.slice(0, 8)}`
        : `aynı proje+ajan açık: ${workDups.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.id.slice(0, 8)}`;
    } else if (c.status === "in_progress" && c.dispatchState === "running") {
      category = "EXECUTABLE";
      why = "running";
    } else if (
      ["planned", "backlog", "in_progress"].includes(c.status) &&
      ["ready", "not_applicable"].includes(c.dispatchState)
    ) {
      if (providerCalls > 2 && acceptanceMet === false) {
        category = "ACCEPTANCE_BLOCKED";
        why = `providerCalls=${providerCalls} acceptanceMet=false`;
      } else {
        category = "EXECUTABLE";
        why = `${c.status}/${c.dispatchState}`;
      }
    } else if (c.dispatchState === "blocked") {
      category = "OWNER_DECISION";
      why = c.blockedReason ?? "dispatch blocked";
    } else {
      category = "STALE_OR_INCONSISTENT";
      why = `${c.status}/${c.dispatchState}`;
    }

    const providerStuck = providerCalls > 0 && !["done", "failed", "awaiting_approval"].includes(c.status);

    return {
      id: c.id,
      parentId: c.parentTaskId,
      projectSlug: c.project.slug,
      assignedAgent: c.assigneeId,
      title: c.title,
      status: c.status,
      dispatchState: c.dispatchState,
      attempts: c.attempts,
      retryBudget,
      blockedReason: c.blockedReason,
      acceptanceMet,
      findingKind: execRes?.findingKind ?? execRes?.work?.findingKind ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      origin: c.origin,
      executionKind: c.executionKind,
      providerCalls,
      lastEvidence: clip(evidenceMsgs.at(-1)?.summary, 140),
      lastResultKind: resultMsgs.at(-1)?.kind ?? null,
      contradiction: contra,
      storm,
      original,
      afterNewApi: c.createdAt >= NEW_API,
      category,
      why,
      providerStuck,
      policy: c.executionPolicy,
    };
  });

  const counts: Record<string, number> = {};
  for (const c of classified) counts[c.category] = (counts[c.category] ?? 0) + 1;

  const pendingReadyMatch = children.filter(
    (c) =>
      ["planned", "in_progress", "backlog"].includes(c.status) &&
      ["ready", "not_applicable"].includes(c.dispatchState),
  );

  const cto = classified.find((c) => c.id === "79648c69-821d-4613-a795-9498bed95dfe");
  const ctoTask = children.find((c) => c.id === "79648c69-821d-4613-a795-9498bed95dfe");
  const ctoExec = parseJson(ctoTask?.executionResult);
  const ctoContract = classifyCtoContract(ctoTask?.acceptanceCriteria, ctoTask?.title);
  const blob = `${ctoExec?.work?.summary ?? ""}\n${ctoTask?.executionResult ?? ""}`;
  const ctoAnalysis = {
    contract: ctoContract,
    claimsDefect: claimsActiveDefect(blob),
    acceptanceMet: ctoExec?.acceptanceMet ?? null,
    findingKind: ctoExec?.findingKind ?? null,
    presentKinds: ctoExec?.presentEvidenceKinds ?? ctoExec?.reasons ?? null,
    reasons: ctoExec?.reasons ?? null,
    canCloseInconclusiveWithoutLlm:
      ctoContract === "inspection_ok" &&
      ctoExec?.acceptanceMet === false &&
      (ctoExec?.findingKind === "none" || !ctoExec?.findingKind),
    canCloseDoneWithoutLoosening: false,
    note: "findingKind=none verifier reddetti; done için acceptance gevşetilir. Sonuçsuz kapanış = failed/no_finding_inconclusive veya Owner retryBudget. Uygulanmadı.",
  };

  const ceoAfterRestart = parents.filter((p) => p.createdAt >= NEW_API);
  const ceoCyclesAfter = ceoAudits.filter((a) => a.at >= NEW_API);

  const statusNow = {
    parentActive: parents.filter((p) => !["done", "failed", "cancelled"].includes(p.status)).length,
    parentAll: parents.length,
    childAll: children.length,
    childActive: children.filter((c) => !["done", "failed", "cancelled"].includes(c.status)).length,
    pendingReadyExec: exec.pendingReady,
    pendingReadyDb: pendingReadyMatch.length,
    running: children.filter((c) => c.dispatchState === "running" || c.status === "in_progress").length,
    blocked: children.filter((c) => c.dispatchState === "blocked" || c.status === "awaiting_approval").length,
    done: children.filter((c) => c.status === "done").length,
    failed: children.filter((c) => c.status === "failed").length,
  };

  const updated15 = {
    childUpdated: children.filter((c) => c.updatedAt >= since15).length,
    doneUpdated: children.filter((c) => c.status === "done" && c.updatedAt >= since15).length,
    agentAudits: audits15.filter((a) => a.action === "ai.local_agent_execution").length,
    ceoAudits: audits15.filter((a) => a.action === "ai.scheduler_ceo_cycle").length,
    parentStateAudits: audits15.filter((a) => a.action === "task.parent_state").length,
  };

  const dryRun = classified
    .filter((c) => c.category === "DUPLICATE" || (c.category === "OWNER_DECISION" && c.id === "79648c69-821d-4613-a795-9498bed95dfe"))
    .map((c) => ({
      id: c.id,
      category: c.category,
      proposed: c.category === "DUPLICATE" ? "Owner onayı ile duplicate işaret/arşiv — UYGULANMADI" : "inconclusive close (failed/no_finding) — UYGULANMADI",
      reversible: true,
    }));

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        epoch,
        grants: {
          githubRepoCreate: grants.githubRepoCreate,
          githubPushDraftPr: grants.githubPushDraftPr,
          customerOutreach: grants.customerOutreach,
          productionDeploy: grants.productionDeploy,
          financialSpend: grants.financialSpend,
          permanentLocalAutonomy: grants.permanentLocalAutonomy,
        },
        health,
        exec: { pendingReady: exec.pendingReady, mode: exec.mode, timerActive: exec.timerActive, completedLocalLlm: exec.completedLocalLlm },
        scheduler: {
          ticking: scheduler.runtime?.ticking,
          lastTickAt: scheduler.runtime?.lastTickAt,
          workerId: scheduler.runtime?.workerId,
          lease: scheduler.lease,
        },
        leases: leases.map((l) => ({ key: l.lockKey, holder: l.holderId, exp: l.expiresAt.toISOString(), expired: l.expiresAt < new Date() })),
        statusNow,
        updated15,
        counts,
        ceoAfterRestart: ceoAfterRestart.map((p) => ({ id: p.id, at: p.createdAt.toISOString(), origin: p.origin })),
        ceoCyclesAfterRestart: ceoCyclesAfter.map((a) => ({
          at: a.at.toISOString(),
          summary: clip(a.summary, 120),
          targetId: a.targetId,
          skipped: parseJson(a.metadata)?.extra?.childCount === 0 || /yazılmadı|skip/i.test(a.summary),
        })),
        parents: parents.map((p) => ({
          id: p.id,
          status: p.status,
          dispatch: p.dispatchState,
          blockedReason: p.blockedReason,
          createdAt: p.createdAt.toISOString(),
          storm: p.createdAt >= STORM_AFTER && p.id !== FIRST_GOOD,
          afterNewApi: p.createdAt >= NEW_API,
          childCount: children.filter((c) => c.parentTaskId === p.id).length,
        })),
        children: classified,
        ctoAnalysis,
        dryRun,
        titleDupGroups: [...titleGroups.entries()]
          .filter(([, v]) => v.length > 1)
          .map(([k, v]) => ({ key: k, ids: v.map((x) => x.id) })),
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
