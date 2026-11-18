/**
 * Yerel Qwen operasyon politikası — ücretli API kotası değil.
 * Eşzamanlı 1 LLM (lease), kuyruk tavanı, backoff, boşta yeni iş uydurmama.
 */
import { getPrisma } from "../db/prisma.js";
import { getEnv } from "../lib/env.js";

export type LocalOpsSkipInput = {
  openTaskCount: number;
  queueCap: number;
  failedOpenCount: number;
  pendingOwnerDecisionCount: number;
  lastCeoAt: Date | null;
  newestAgentResultAt: Date | null;
  minIntervalMs: number;
  now: Date;
};

export function evaluateIdleSkip(input: LocalOpsSkipInput): { skip: boolean; reason?: string } {
  if (input.openTaskCount >= input.queueCap) {
    return { skip: true, reason: "queue_cap_reached" };
  }

  const lastCeo = input.lastCeoAt?.getTime();
  if (lastCeo && input.minIntervalMs > 0 && input.now.getTime() - lastCeo < input.minIntervalMs) {
    const newest = input.newestAgentResultAt?.getTime() ?? 0;
    const hasNewEvidence = newest > lastCeo;
    if (!hasNewEvidence && input.failedOpenCount === 0 && input.pendingOwnerDecisionCount === 0) {
      return { skip: true, reason: "idle_no_new_evidence" };
    }
  }

  return { skip: false };
}

export function nextBackoffMs(consecutiveProviderFailures: number): number {
  const n = Math.max(0, consecutiveProviderFailures);
  const ms = Math.min(60 * 60 * 1000, 15_000 * 2 ** Math.min(n, 8));
  return ms;
}

export function evaluateBackoff(input: {
  consecutiveProviderFailures: number;
  lastFailureAt: Date | null;
  now: Date;
}): { skip: boolean; reason?: string; waitMs: number } {
  if (input.consecutiveProviderFailures <= 0 || !input.lastFailureAt) {
    return { skip: false, waitMs: 0 };
  }
  const waitMs = nextBackoffMs(input.consecutiveProviderFailures);
  const elapsed = input.now.getTime() - input.lastFailureAt.getTime();
  if (elapsed < waitMs) {
    return { skip: true, reason: "provider_backoff", waitMs };
  }
  return { skip: false, waitMs };
}

export async function evaluateScheduledCeoIdleSkip(now = new Date()): Promise<{
  skip: boolean;
  reason?: string;
}> {
  const env = getEnv();
  const prisma = getPrisma();
  const minIntervalMs =
    env.NODE_ENV === "test" ? 0 : env.LOCAL_OPS_CEO_MIN_INTERVAL_MS;

  const { isCeoEventPending } = await import("./deferred-llm-queue.js");
  if (await isCeoEventPending()) {
    return { skip: false };
  }

  const { readOperationEpoch } = await import("./operation-epoch.js");
  const epoch = await readOperationEpoch();
  const after = epoch ? new Date(epoch.startedAt) : undefined;

  const [openTaskCount, failedOpenCount, pendingOwnerDecisionCount, lastCeo, newestResult] =
    await Promise.all([
      prisma.task.count({
        where: {
          archivedAt: null,
          source: "real",
          ...(after ? { createdAt: { gte: after } } : {}),
          status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
        },
      }),
      prisma.task.count({
        where: { archivedAt: null, source: "real", status: "failed" },
      }),
      prisma.task.count({
        where: { archivedAt: null, source: "real", status: "awaiting_approval" },
      }),
      prisma.auditLog.findFirst({
        where: {
          action: "ai.scheduler_ceo_cycle",
          ...(after ? { at: { gte: after } } : {}),
        },
        orderBy: { at: "desc" },
        select: { at: true },
      }),
      prisma.agentMessage.findFirst({
        where: {
          kind: { in: ["result", "handoff"] },
          ...(after ? { createdAt: { gte: after } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  return evaluateIdleSkip({
    openTaskCount,
    queueCap: env.LOCAL_OPS_OPEN_TASK_CAP,
    failedOpenCount,
    pendingOwnerDecisionCount,
    lastCeoAt: lastCeo?.at ?? null,
    newestAgentResultAt: newestResult?.createdAt ?? null,
    minIntervalMs,
    now,
  });
}
