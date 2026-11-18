import type { FastifyInstance } from "fastify";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { countSchedulerAiCeoRunsToday, getQuotaSnapshot } from "../../ai/llm-call-guard.js";
import { AI_CEO_SCHEDULER_ORIGIN_PREFIX } from "../../ai/ai-ceo-scheduler.js";
import { getLocalAgentExecutionStatus } from "../../ai/local-agent-execution.js";
import { getEnv } from "../../lib/env.js";
import { getPrisma } from "../../db/prisma.js";
import { getKillSwitch } from "../../engines/kill-switch.js";
import {
  ensureDefaultAutonomyJobs,
  ensureDefaultGoalsAndPolicies,
  getSchedulerRuntimeStatus,
  schedulerTick,
} from "../../engines/autonomy-scheduler.js";
import { describeAutomationRuntime } from "../../engines/automation-runtime.js";
import { dispatchAutonomousChildren } from "../../engines/autonomy-dispatch.js";
import { runDeterministicCeoCycle } from "../../engines/ceo-orchestrator.js";
import { runReconciliationPass } from "../../engines/run-reconciliation.js";
import { scanOpportunities } from "../../engines/opportunity-engine.js";

export async function autonomyRoutes(app: FastifyInstance) {
  app.get("/api/autonomy/status", async (request) => {
    requireAuth(request);
    const env = getEnv();
    const prisma = getPrisma();
    const runtime = getSchedulerRuntimeStatus();
    const [jobs, goals, opportunities, messages, recentRuns, aiRunsToday, aiParents, quota, kill] =
      await Promise.all([
        prisma.scheduledJob.findMany({ orderBy: { jobKey: "asc" } }),
        prisma.companyGoal.count(),
        prisma.opportunity.count(),
        prisma.agentMessage.count(),
        prisma.scheduledJobRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
        countSchedulerAiCeoRunsToday(),
        prisma.task.count({
          where: {
            archivedAt: null,
            parentTaskId: null,
            origin: { startsWith: AI_CEO_SCHEDULER_ORIGIN_PREFIX },
          },
        }),
        getQuotaSnapshot(),
        getKillSwitch(),
      ]);
    const mode = env.SCHEDULER_AI_CEO_MODE;
    const controlled = env.CONTROLLED_AUTONOMY_MODE;
    const planner =
      mode === "local" ? "local_llm" : mode === "mock" ? "mock_llm" : "deterministic";
    const agentExec = await getLocalAgentExecutionStatus();
    const { enforceAutonomyWindow } = await import("../../engines/autonomy-window.js");
    const windowGate = await enforceAutonomyWindow();
    const grants = await (await import("../../engines/owner-grants.js")).readOwnerGrants();
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
      phase: "5E",
      planner,
      deterministicPlannerAvailable: true,
      schedulerAiCeoMode: mode,
      controlledAutonomyMode: controlled,
      continuousAutomation: automation.continuousAutomation,
      automation,
      schedulerRuntime: runtime,
      quota,
      autonomyWindow: windowGate,
      llmIntegrated: mode !== "off",
      localLlmScheduledEnabled: mode === "local",
      localAgentExecution: agentExec,
      cloudAutoDispatch: false,
      realAiExecution: false,
      note: automation.continuousAutomation
        ? "Timer bu süreçte otonomi kapılarını çalıştırıyor (süresiz sınırsız değil)."
        : `${automation.reason}. Manuel tick: POST /api/autonomy/scheduler/tick (Owner). Timer yoksa otonom değildir.`,
      limits: {
        maxPerDay: env.SCHEDULER_AI_CEO_MAX_PER_DAY,
        agentMaxPerDay: env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY,
        perAgentMaxPerDay: env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY,
        tickMax: env.LOCAL_AGENT_TICK_MAX,
        maxRetries: env.CONTROLLED_AUTONOMY_MAX_RETRIES,
        runsToday: aiRunsToday,
        ceoRealUsed: quota.sources.ceoReal,
        ceoMockUsed: quota.sources.ceoMock,
        agentRealUsed: quota.sources.agentReal,
        agentMockUsed: quota.sources.agentMock,
        nextEligibleAt: quota.nextEligibleAt,
        concurrentLocalLlmCalls: 1,
      },
      counts: { goals, opportunities, messages, aiCeoParentTasks: aiParents },
      jobs: jobs.map((j) => ({
        jobKey: j.jobKey,
        enabled: j.enabled,
        cronExpr: j.cronExpr,
        lastStatus: j.lastStatus,
        lastFinishedAt: j.lastFinishedAt?.toISOString() ?? null,
      })),
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        message: r.message,
        idempotencyKey: r.idempotencyKey,
      })),
    };
  });

  app.get("/api/autonomy/goals", async (request) => {
    requireAuth(request);
    const goals = await getPrisma().companyGoal.findMany({ orderBy: { projectSlug: "asc" } });
    return { source: "api" as const, goals };
  });

  app.get("/api/autonomy/opportunities", async (request) => {
    requireAuth(request);
    const opportunities = await getPrisma().opportunity.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { source: "api" as const, opportunities, plannerNote: "deterministic_not_llm" };
  });

  app.get("/api/autonomy/messages", async (request) => {
    requireAuth(request);
    const messages = await getPrisma().agentMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { source: "api" as const, messages };
  });

  app.get("/api/autonomy/tasks", async (request) => {
    requireAuth(request);
    const tasks = await getPrisma().task.findMany({
      where: {
        archivedAt: null,
        OR: [
          { origin: { startsWith: "opportunity:" } },
          { origin: { startsWith: AI_CEO_SCHEDULER_ORIGIN_PREFIX } },
          { executionPolicy: "AUTO" },
        ],
      },
      include: { project: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      source: "api" as const,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        projectSlug: t.project.slug,
        assigneeId: t.assigneeId,
        parentTaskId: t.parentTaskId,
        executionPolicy: t.executionPolicy,
        executionKind: t.executionKind,
        origin: t.origin,
        model: t.model,
        dispatchState: t.dispatchState,
        blockedReason: t.blockedReason,
        createdAt: t.createdAt.toISOString(),
        plannerChannel: t.origin?.startsWith(AI_CEO_SCHEDULER_ORIGIN_PREFIX)
          ? t.executionKind === "real_ai_pending"
            ? "local_llm"
            : "mock_or_deterministic"
          : "deterministic_chain",
      })),
    };
  });

  app.post("/api/autonomy/scheduler/tick", async (request) => {
    requireOwner(request);
    await ensureDefaultAutonomyJobs();
    await ensureDefaultGoalsAndPolicies();
    const result = await schedulerTick(new Date(), { trigger: "manual_api" });
    return { source: "api" as const, trigger: "manual_api", timerDriven: false, ...result };
  });

  app.post("/api/autonomy/ceo/cycle", async (request) => {
    requireOwner(request);
    const cycle = await runDeterministicCeoCycle({
      idempotencySuffix: `manual-${Date.now()}`,
    });
    let dispatch: Awaited<ReturnType<typeof dispatchAutonomousChildren>> = [];
    if (cycle.parentTaskId) {
      dispatch = await dispatchAutonomousChildren(cycle.parentTaskId);
    }
    return { source: "api" as const, ...cycle, dispatch };
  });

  app.post("/api/autonomy/opportunities/scan", async (request) => {
    requireOwner(request);
    const scan = await scanOpportunities();
    return { source: "api" as const, ...scan };
  });

  app.post("/api/autonomy/reconciliation/run", async (request) => {
    requireOwner(request);
    const result = await runReconciliationPass();
    return { source: "api" as const, ...result };
  });
}
