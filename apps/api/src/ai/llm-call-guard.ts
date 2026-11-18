import { getPrisma } from "../db/prisma.js";
import { getEnv } from "../lib/env.js";
import {
  acquireLease,
  releaseLease,
  type LeaseAcquireResult,
} from "../engines/worker-lease.js";
import {
  budgetResult,
  countQuotaFromRows,
  utcDayBounds,
  type QuotaAuditRow,
} from "./llm-quota.js";

/** Aynı anda en fazla 1 yerel/mock LLM çağrısı */
export const LOCAL_LLM_CALL_LEASE_KEY = "llm:local:call";

const QUOTA_ACTIONS = ["ai.scheduler_ceo_cycle", "ai.local_agent_execution"] as const;

async function loadQuotaRows(now: Date): Promise<QuotaAuditRow[]> {
  const { start, end } = utcDayBounds(now);
  const prisma = getPrisma();
  return prisma.auditLog.findMany({
    where: {
      action: { in: [...QUOTA_ACTIONS] },
      at: { gte: start, lt: end },
    },
    select: { id: true, action: true, actorAgent: true, metadata: true },
  });
}

export async function getQuotaSnapshot(now = new Date()) {
  const env = getEnv();
  const rows = await loadQuotaRows(now);
  const counts = countQuotaFromRows(rows);
  const { start, end } = utcDayBounds(now);
  const { isAutonomyWindowActive, readAutonomyWindow } = await import("../engines/autonomy-window.js");
  const window = await readAutonomyWindow();
  const windowActive = isAutonomyWindowActive(window, now);
  const unlimited = env.LOCAL_OPS_UNLIMITED_DAILY && !windowActive;
  const ceoMax = windowActive && window
    ? window.limits.SCHEDULER_AI_CEO_MAX_PER_DAY
    : unlimited
      ? 10_000
      : env.SCHEDULER_AI_CEO_MAX_PER_DAY;
  const agentMax =
    windowActive && window
      ? window.limits.LOCAL_AGENT_EXECUTION_MAX_PER_DAY
      : unlimited
        ? 10_000
        : env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY;
  const perAgentMax =
    windowActive && window
      ? window.limits.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY
      : unlimited
        ? 24
        : env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY;
  const ceoMode = env.SCHEDULER_AI_CEO_MODE;
  const agentMode = env.LOCAL_AGENT_EXECUTION_MODE;
  const ceoUsed = ceoMode === "local" ? counts.ceoReal : ceoMode === "mock" ? counts.ceoMock : 0;
  const agentUsed =
    agentMode === "local" ? counts.agentReal : agentMode === "mock" ? counts.agentMock : 0;
  const ceo = budgetResult(ceoUsed, ceoMax, "daily_llm_cap_reached", now);
  const agents = budgetResult(agentUsed, agentMax, "daily_agent_llm_cap_reached", now);
  return {
    utcDay: start.toISOString().slice(0, 10),
    utcDayStart: start.toISOString(),
    nextEligibleAt: end.toISOString(),
    policy: {
      mockConsumesReal: false,
      failedRealCalls: "count_if_provider_invoked",
      dedupe: "quotaCallId",
      timezone: "UTC" as const,
      note: windowActive
        ? "T-P5E pencere limitleri (pilot). ai.local_ceo_pilot kotaya dahil değil."
        : unlimited
          ? "Yerel Qwen: günlük çağrı kotası yok; eşzamanlı 1 + kuyruk/idle/backoff."
          : "ai.local_ceo_pilot scheduler/ajan kotasına dahil edilmez.",
      dailyCapMode: windowActive ? "window" : unlimited ? "unlimited_local" : "env_pilot",
    },
    sources: {
      ceoReal: counts.ceoReal,
      ceoMock: counts.ceoMock,
      agentReal: counts.agentReal,
      agentMock: counts.agentMock,
      perAgentReal: counts.perAgentReal,
      perAgentMock: counts.perAgentMock,
    },
    ceo: { ...ceo, mode: ceoMode, realUsed: counts.ceoReal, mockUsed: counts.ceoMock },
    agents: {
      ...agents,
      mode: agentMode,
      realUsed: counts.agentReal,
      mockUsed: counts.agentMock,
    },
    perAgentMax,
    windowActive,
    windowExpiresAt: window?.expiresAt ?? null,
  };
}

/** UTC gün içinde gerçek ajan local LLM çağrıları (CEO/pilot karışmaz). */
export async function countRealLocalModelCallsToday(now = new Date()): Promise<number> {
  const snap = await getQuotaSnapshot(now);
  return snap.sources.agentReal;
}

export async function countSchedulerAiCeoRunsToday(now = new Date()): Promise<number> {
  const snap = await getQuotaSnapshot(now);
  const env = getEnv();
  if (env.SCHEDULER_AI_CEO_MODE === "local") return snap.sources.ceoReal;
  if (env.SCHEDULER_AI_CEO_MODE === "mock") return snap.sources.ceoMock;
  // off: gerçek kotayı raporla (mock ile şişirme)
  return snap.sources.ceoReal;
}

export async function assertSchedulerAiCeoDailyBudget(now = new Date()): Promise<{
  ok: boolean;
  used: number;
  max: number;
  reason?: string;
  nextEligibleAt?: string;
}> {
  const snap = await getQuotaSnapshot(now);
  if (getEnv().SCHEDULER_AI_CEO_MODE === "off") {
    return { ok: true, used: snap.sources.ceoReal, max: snap.ceo.max, nextEligibleAt: snap.nextEligibleAt };
  }
  return snap.ceo;
}

export async function assertLocalAgentExecutionDailyBudget(now = new Date()): Promise<{
  ok: boolean;
  used: number;
  max: number;
  reason?: string;
  nextEligibleAt?: string;
}> {
  const env = getEnv();
  const snap = await getQuotaSnapshot(now);
  if (env.LOCAL_AGENT_EXECUTION_MODE === "off") {
    return {
      ok: true,
      used: snap.sources.agentReal,
      max: snap.agents.max,
      nextEligibleAt: snap.nextEligibleAt,
    };
  }
  return snap.agents;
}

export async function assertPerAgentDailyBudget(
  agentId: string,
  now = new Date(),
): Promise<{ ok: boolean; used: number; max: number; reason?: string; nextEligibleAt?: string }> {
  const env = getEnv();
  const snap = await getQuotaSnapshot(now);
  const used =
    env.LOCAL_AGENT_EXECUTION_MODE === "local"
      ? snap.sources.perAgentReal[agentId] ?? 0
      : env.LOCAL_AGENT_EXECUTION_MODE === "mock"
        ? snap.sources.perAgentMock[agentId] ?? 0
        : 0;
  const max = snap.perAgentMax;
  const r = budgetResult(used, max, `per_agent_daily_cap:${agentId}`, now);
  if (env.LOCAL_AGENT_EXECUTION_MODE === "off") {
    return { ok: true, used: snap.sources.perAgentReal[agentId] ?? 0, max, nextEligibleAt: r.nextEligibleAt };
  }
  return r;
}

export async function acquireLocalLlmCallLease(
  ttlMs = 180_000,
  purpose = "scheduler-ai-ceo",
): Promise<LeaseAcquireResult> {
  return acquireLease(LOCAL_LLM_CALL_LEASE_KEY, ttlMs, { purpose });
}

export async function releaseLocalLlmCallLease(): Promise<void> {
  await releaseLease(LOCAL_LLM_CALL_LEASE_KEY).catch(() => undefined);
}

export function taskExecutionLeaseKey(taskId: string): string {
  return `task:exec:${taskId}`;
}

export async function acquireTaskExecutionLease(
  taskId: string,
  ttlMs = 180_000,
): Promise<LeaseAcquireResult> {
  return acquireLease(taskExecutionLeaseKey(taskId), ttlMs, { purpose: "local-agent-exec" });
}

export async function releaseTaskExecutionLease(taskId: string): Promise<void> {
  await releaseLease(taskExecutionLeaseKey(taskId)).catch(() => undefined);
}
