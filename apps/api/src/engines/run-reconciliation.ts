import { getPrisma } from "../db/prisma.js";
import { getCursorCloudAdapter } from "../cursor/adapter.js";
import { safeErrorMessage } from "../cursor/sanitize.js";
import { writeAudit } from "./audit.js";

const ACTIVE = new Set(["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"]);

/** Mock CREATING bu süreden eskiyse stale işaretlenir (live kapasiteyi etkilemez). */
export const MOCK_STALE_TTL_MS = 15 * 60 * 1000;

export async function markStaleMockRuns(now = new Date()): Promise<{ marked: number }> {
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - MOCK_STALE_TTL_MS);
  const candidates = await prisma.agentRun.findMany({
    where: {
      executionMode: "mock",
      cursorStatus: { in: [...ACTIVE] },
      OR: [{ reconcileState: null }, { reconcileState: { notIn: ["stale_mock", "archived"] } }],
      createdAt: { lt: cutoff },
    },
    take: 50,
  });

  let marked = 0;
  for (const run of candidates) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "cancelled",
        cursorStatus: "CANCELLED",
        reconcileState: "stale_mock",
        staleAt: now,
        lastReconciledAt: now,
        finishedAt: now,
        message: "Stale mock run TTL aşıldı; live kapasiteyi etkilemez.",
        errorMessage: "stale_mock_ttl",
      },
    });
    // Yanlış "ajan çalışıyor" göstergesini temizle: yalnızca bu stale mock aktifse
    const otherActive = await prisma.agentRun.count({
      where: {
        taskId: run.taskId,
        id: { not: run.id },
        cursorStatus: { in: [...ACTIVE] },
        reconcileState: { notIn: ["stale_mock", "archived"] },
      },
    });
    if (otherActive === 0) {
      await prisma.task.updateMany({
        where: {
          id: run.taskId,
          dispatchState: "dispatched",
          status: { in: ["in_progress", "testing"] },
        },
        data: {
          dispatchState: "ready",
          blockedReason: "stale_mock_cleared",
          updatedAt: now,
        },
      });
    }
    await writeAudit({
      category: "cloud",
      action: "cloud.stale_mock_marked",
      actorKind: "system",
      targetType: "agent_run",
      targetId: run.id,
      summary: "Stale mock CREATING/RUNNING TTL ile kapatıldı; görev göstergesi temizlendi.",
      metadata: { executionMode: "mock", createdAt: run.createdAt.toISOString() },
    });
    marked += 1;
  }
  return { marked };
}

/** Live run’ları Cursor API ile uzlaştırır; belirsizlikte ikinci create yok. */
export async function reconcileLiveRuns(): Promise<{ checked: number; updated: number; errors: number }> {
  const prisma = getPrisma();
  const adapter = getCursorCloudAdapter();
  const live = await prisma.agentRun.findMany({
    where: {
      executionMode: "live",
      cursorAgentId: { not: null },
      cursorRunId: { not: null },
      cursorStatus: { in: [...ACTIVE] },
    },
    take: 20,
    orderBy: { updatedAt: "asc" },
  });

  let updated = 0;
  let errors = 0;
  for (const run of live) {
    try {
      const synced = await adapter.getRun(run.cursorAgentId!, run.cursorRunId!);
      const terminal = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(synced.run.status);
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          cursorStatus: synced.run.status,
          status: synced.run.status.toLowerCase(),
          resultSummary: synced.run.result?.slice(0, 4000) ?? run.resultSummary,
          branch: synced.run.git?.branches?.[0]?.branch ?? run.branch,
          finishedAt: terminal ? new Date() : null,
          lastReconciledAt: new Date(),
          reconcileState: synced.unknownStatus ? "unknown" : "ok",
          message: synced.domain.label,
        },
      });
      updated += 1;
    } catch (error) {
      errors += 1;
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          lastReconciledAt: new Date(),
          reconcileState: "unknown",
          message: safeErrorMessage(error).slice(0, 1000),
        },
      });
    }
  }
  return { checked: live.length, updated, errors };
}

export async function runReconciliationPass(): Promise<{
  staleMarked: number;
  liveChecked: number;
  liveUpdated: number;
  liveErrors: number;
}> {
  const stale = await markStaleMockRuns();
  const live = await reconcileLiveRuns();
  return {
    staleMarked: stale.marked,
    liveChecked: live.checked,
    liveUpdated: live.updated,
    liveErrors: live.errors,
  };
}
