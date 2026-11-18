import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { checkDatabase } from "../../db/prisma.js";
import { getSchedulerRuntimeStatus } from "../../engines/autonomy-scheduler.js";
import { getKillSwitch, setKillSwitch } from "../../engines/kill-switch.js";
import { listWorkerHealth } from "../../engines/worker-lease.js";
import { validationError } from "../../lib/errors.js";

export async function systemRoutes(app: FastifyInstance) {
  app.get("/api/system/health", async () => {
    const db = await checkDatabase();
    const runtime = getSchedulerRuntimeStatus();
    return {
      ok: db.ok,
      service: "synaptech-api",
      phase: "5D",
      database: db,
      scheduler: {
        timerActive: runtime.timerActive,
        lastTickAt: runtime.lastTickAt,
        workerId: runtime.workerId,
      },
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/system/scheduler", async (request) => {
    requireAuth(request);
    const [db, kill, workers] = await Promise.all([
      checkDatabase(),
      getKillSwitch(),
      listWorkerHealth().catch(() => ({ workerId: "n/a", workers: [], leases: [] })),
    ]);
    const runtime = getSchedulerRuntimeStatus();
    const lease = workers.leases.find((l) => l.lockKey === runtime.leaseKey);
    const schedulerAlive = runtime.timerActive;
    const recentTick =
      runtime.lastTickAt !== null &&
      Date.now() - new Date(runtime.lastTickAt).getTime() < 5 * 60_000;
    return {
      source: "api" as const,
      phase: "5D",
      ok: db.ok,
      schedulerTimerActive: runtime.timerActive,
      recentTick,
      autonomous: schedulerAlive && !kill.enabled,
      killSwitch: kill,
      runtime,
      lease: lease ?? null,
      workers: workers.workers,
      cloudLive: false,
      note: runtime.timerActive
        ? "Bu süreç timer sahibidir. Lease ikinci worker'ı dışlar."
        : "Bu süreçte timer yok (script veya EMBED_SCHEDULER=0). lastTickAt otonomi kanıtı değildir.",
    };
  });

  app.get("/api/system/workers", async (request) => {
    requireAuth(request);
    return { source: "api" as const, phase: "5D", ...(await listWorkerHealth()) };
  });

  app.get("/api/system/status", async (request) => {
    requireAuth(request);
    const [db, kill, workers] = await Promise.all([
      checkDatabase(),
      getKillSwitch(),
      listWorkerHealth().catch(() => ({ workers: [], leases: [] })),
    ]);
    const runtime = getSchedulerRuntimeStatus();
    return {
      phase: {
        current: 5,
        total: 5,
        label: "Faz 5D — 7/24 altyapı (izole staging; production VPS yok)",
      },
      autonomy: kill.enabled ? "paused_kill_switch" : "scheduler_lease_guarded",
      killSwitch: kill,
      database: db,
      scheduler: runtime,
      workerCount: workers.workers?.length ?? 0,
      integrations: {
        cursor: "see_/api/integrations/status",
        github: "unknown_see_/api/integrations/status",
        task_engine: db.ok ? "local_mssql" : "unavailable",
        database: db.ok ? "connected" : "disconnected",
        cloud_live: "disabled",
        worker_lease: "mssql",
      },
      statement:
        "Faz 5D: izole worker/scheduler hazır. Entegrasyon gözlemi: GET /api/integrations/status. Production VPS'e dokunulmaz.",
    };
  });

  app.get("/api/system/kill-switch", async (request) => {
    requireAuth(request);
    const kill = await getKillSwitch();
    return {
      source: "api" as const,
      authority: kill.source,
      operationalEnabled: kill.enabled,
      conflict: kill.conflict,
      dbEnabled: kill.dbEnabled,
      fileEnabled: kill.fileEnabled,
      killSwitch: kill,
      ownerFileProcedure:
        "Ajan config/kill-switch.json yazmaz. Owner dosyayı elle DB ile aynı enabled değerine çeker veya PATCH /api/system/kill-switch kullanır (dosya senkronu hook izin verirse).",
      note: "Çelişkide fail-safe OR: herhangi biri açıksa otonomi kapalıdır.",
    };
  });

  app.patch("/api/system/kill-switch", async (request) => {
    const principal = requireOwner(request);
    const body = z
      .object({
        enabled: z.boolean(),
        reason: z.string().max(500).nullable().optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Geçersiz gövde.", body.error.flatten());
    const state = await setKillSwitch(principal, body.data);
    return { killSwitch: state };
  });
}
