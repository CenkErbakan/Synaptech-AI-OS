import { getPrisma } from "../db/prisma.js";
import { getEnv } from "../lib/env.js";
import { getQuotaSnapshot } from "../ai/llm-call-guard.js";
import { getKillSwitch } from "./kill-switch.js";
import { getSchedulerRuntimeStatus } from "./autonomy-scheduler.js";
import { describeAutomationRuntime } from "./automation-runtime.js";
import { listOwnerDecisionQueue } from "./owner-decision-queue.js";
import { GRANT_LABELS, readOwnerGrants } from "./owner-grants.js";
import { countEpochTasks, readOperationEpoch } from "./operation-epoch.js";
import { readDeferredLlmQueue } from "./deferred-llm-queue.js";
import { evaluateGithubWrite } from "./github-write-adapter.js";
import { parseLeadCrm } from "./crm-lead.js";
import { isSelfPropertyUrl } from "./growth-engine.js";

export async function buildCommandCenter() {
  const env = getEnv();
  const prisma = getPrisma();
  const now = new Date();
  const runtime = getSchedulerRuntimeStatus();
  const [
    kill,
    quota,
    epoch,
    grants,
    queue,
    deferred,
    windowGate,
    leads,
    drafts,
    ceoAudits,
  ] = await Promise.all([
    getKillSwitch(),
    getQuotaSnapshot(now),
    readOperationEpoch(),
    readOwnerGrants(),
    listOwnerDecisionQueue(),
    readDeferredLlmQueue(),
    import("./autonomy-window.js").then((m) => m.enforceAutonomyWindow(now)),
    prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.contentDraftRecord.count({ where: { status: { not: "published" } } }).catch(() => 0),
    prisma.auditLog.findMany({
      where: { action: "ai.scheduler_ceo_cycle" },
      orderBy: { at: "desc" },
      take: 5,
    }),
  ]);
  const epochCounts = await countEpochTasks(epoch);
  const automation = describeAutomationRuntime({
    env,
    killEnabled: kill.enabled,
    timerActive: runtime.timerActive,
    lastTickTrigger: runtime.lastTickTrigger,
    windowActive: windowGate.active,
    permanentLocalAutonomy: grants.permanentLocalAutonomy,
  });

  return {
    source: "api" as const,
    generatedAt: now.toISOString(),
    operationEpoch: epoch,
    epochCounts,
    company: {
      killSwitch: kill.enabled,
      continuousAutomation: automation.continuousAutomation,
      automationReason: automation.reason,
      timerActive: runtime.timerActive,
      workerId: runtime.workerId,
      pcRequiredForLocalAi: true,
      cloudFallback: false,
      deferredLlmJobs: deferred.length,
      ollamaQueued: deferred.map((j) => j.kind),
    },
    llm: {
      dailyCapMode: quota.policy.dailyCapMode ?? "env_pilot",
      policyNote: quota.policy.note,
      concurrentMax: 1,
      ceoUsed: quota.sources.ceoReal,
      agentUsed: quota.sources.agentReal,
      windowActive: quota.windowActive,
      windowExpiresAt: quota.windowExpiresAt,
    },
    grants: {
      values: grants,
      labels: GRANT_LABELS,
      githubWrite: evaluateGithubWrite(
        { taskId: "status", projectSlug: "synaptech-ai-os", verifiedRepo: true },
        grants,
        env.GITHUB_WRITE_MODE,
      ),
    },
    ownerInbox: {
      pendingCount: queue.pendingCount,
      items: queue.items.slice(0, 12),
    },
    ceo: {
      lastDecisions: ceoAudits.map((a) => ({
        at: a.at.toISOString(),
        summary: a.summary,
        realAi: Boolean(
          a.metadata && JSON.stringify(a.metadata).includes('"realAiExecution":true'),
        ),
      })),
    },
    crm: {
      recentLeads: leads
        .filter((l) => !isSelfPropertyUrl(l.sourceUrl ?? l.websiteUrl ?? ""))
        .map((l) => ({
        id: l.id,
        companyName: l.companyName,
        sourceUrl: l.sourceUrl,
        verified: l.verified,
        needSignal: l.needSignal,
        projectSlug: l.projectSlug,
        ...parseLeadCrm(l.notes),
      })),
    },
    publishing: {
      unpublishedDrafts: drafts,
      outreachGranted: grants.customerOutreach,
      spendGranted: grants.financialSpend,
      deployGranted: grants.productionDeploy,
    },
    modes: {
      schedulerAiCeoMode: env.SCHEDULER_AI_CEO_MODE,
      localAgentExecutionMode: env.LOCAL_AGENT_EXECUTION_MODE,
      controlledAutonomyMode: env.CONTROLLED_AUTONOMY_MODE,
      githubWriteMode: env.GITHUB_WRITE_MODE,
    },
  };
}
