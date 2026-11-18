import { hostname as osHostname } from "node:os";
import { randomUUID } from "node:crypto";

import { getPrisma } from "../db/prisma.js";

export const DEFAULT_LEASE_TTL_MS = 30_000;

let cachedWorkerId: string | null = null;

export function getWorkerId(): string {
  if (cachedWorkerId) return cachedWorkerId;
  cachedWorkerId =
    process.env.WORKER_ID?.trim() ||
    `worker-${osHostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  return cachedWorkerId;
}

/** Testler için: farklı holder simülasyonu */
export function resetWorkerIdForTests(nextId?: string): void {
  cachedWorkerId = nextId ?? null;
}

export interface LeaseAcquireResult {
  acquired: boolean;
  lockKey: string;
  holderId: string;
  expiresAt: string | null;
  reason?: string;
}

/**
 * MSSQL üzerinde distributed lease.
 * Süresi dolmuş veya aynı holder ise yenilenir; aksi halde reddedilir.
 */
export async function acquireLease(
  lockKey: string,
  ttlMs = DEFAULT_LEASE_TTL_MS,
  meta?: Record<string, unknown>,
): Promise<LeaseAcquireResult> {
  const prisma = getPrisma();
  const holderId = getWorkerId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const metaJson = meta ? JSON.stringify(meta).slice(0, 4000) : null;

  const existing = await prisma.workerLease.findUnique({ where: { lockKey } });
  if (!existing) {
    try {
      await prisma.workerLease.create({
        data: {
          lockKey,
          holderId,
          acquiredAt: now,
          expiresAt,
          heartbeatAt: now,
          metaJson,
        },
      });
      return { acquired: true, lockKey, holderId, expiresAt: expiresAt.toISOString() };
    } catch {
      // Yarış: başka worker oluşturdu
      const again = await prisma.workerLease.findUnique({ where: { lockKey } });
      if (again && again.expiresAt <= now) {
        // fall through to steal expired below via update
      } else if (again && again.holderId !== holderId && again.expiresAt > now) {
        return {
          acquired: false,
          lockKey,
          holderId: again.holderId,
          expiresAt: again.expiresAt.toISOString(),
          reason: "held_by_other",
        };
      }
    }
  }

  const current = await prisma.workerLease.findUnique({ where: { lockKey } });
  if (!current) {
    return { acquired: false, lockKey, holderId, expiresAt: null, reason: "missing_after_race" };
  }
  if (current.holderId !== holderId && current.expiresAt > now) {
    return {
      acquired: false,
      lockKey,
      holderId: current.holderId,
      expiresAt: current.expiresAt.toISOString(),
      reason: "held_by_other",
    };
  }

  // Owner veya expired → yenile (optimistic: expiresAt/holder eşleşmesi)
  const updated = await prisma.workerLease.updateMany({
    where: {
      lockKey,
      OR: [{ holderId }, { expiresAt: { lte: now } }],
    },
    data: {
      holderId,
      acquiredAt: current.holderId === holderId ? current.acquiredAt : now,
      expiresAt,
      heartbeatAt: now,
      metaJson,
    },
  });

  if (updated.count === 0) {
    const again = await prisma.workerLease.findUnique({ where: { lockKey } });
    return {
      acquired: false,
      lockKey,
      holderId: again?.holderId ?? "unknown",
      expiresAt: again?.expiresAt.toISOString() ?? null,
      reason: "lost_race",
    };
  }

  return { acquired: true, lockKey, holderId, expiresAt: expiresAt.toISOString() };
}

export async function renewLease(lockKey: string, ttlMs = DEFAULT_LEASE_TTL_MS): Promise<boolean> {
  const prisma = getPrisma();
  const holderId = getWorkerId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const res = await prisma.workerLease.updateMany({
    where: { lockKey, holderId, expiresAt: { gt: now } },
    data: { expiresAt, heartbeatAt: now },
  });
  return res.count === 1;
}

export async function releaseLease(lockKey: string): Promise<void> {
  const prisma = getPrisma();
  const holderId = getWorkerId();
  await prisma.workerLease.deleteMany({ where: { lockKey, holderId } });
}

export async function registerWorkerInstance(role: string): Promise<string> {
  const prisma = getPrisma();
  const id = getWorkerId();
  const now = new Date();
  await prisma.workerInstance.upsert({
    where: { id },
    create: {
      id,
      role,
      hostname: osHostname(),
      startedAt: now,
      lastSeenAt: now,
      status: "running",
      metaJson: JSON.stringify({ pid: process.pid, faz: "5D" }),
    },
    update: {
      role,
      hostname: osHostname(),
      lastSeenAt: now,
      status: "running",
      stopReason: null,
    },
  });
  return id;
}

export async function heartbeatWorkerInstance(): Promise<void> {
  const prisma = getPrisma();
  await prisma.workerInstance.updateMany({
    where: { id: getWorkerId() },
    data: { lastSeenAt: new Date(), status: "running" },
  });
}

export async function stopWorkerInstance(reason: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.workerInstance.updateMany({
    where: { id: getWorkerId() },
    data: { status: "stopped", stopReason: reason.slice(0, 500), lastSeenAt: new Date() },
  });
}

export async function listWorkerHealth(staleMs = 90_000) {
  const prisma = getPrisma();
  const now = Date.now();
  const workers = await prisma.workerInstance.findMany({ orderBy: { lastSeenAt: "desc" }, take: 50 });
  const leases = await prisma.workerLease.findMany({ orderBy: { lockKey: "asc" } });
  return {
    workerId: getWorkerId(),
    workers: workers.map((w) => ({
      id: w.id,
      role: w.role,
      status: w.status,
      lastSeenAt: w.lastSeenAt.toISOString(),
      stale: now - w.lastSeenAt.getTime() > staleMs,
      stopReason: w.stopReason,
    })),
    leases: leases.map((l) => ({
      lockKey: l.lockKey,
      holderId: l.holderId,
      expiresAt: l.expiresAt.toISOString(),
      expired: l.expiresAt.getTime() <= now,
      heartbeatAt: l.heartbeatAt.toISOString(),
    })),
  };
}
