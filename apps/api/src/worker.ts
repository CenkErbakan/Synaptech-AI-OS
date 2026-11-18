/**
 * Faz 5D — API-bağımsız scheduler/worker süreci.
 * Cursor IDE veya Dashboard açık olmadan çalışır.
 * Gerçek Cloud Agent / ücretli AI çağrısı yapmaz.
 */
import { buildApp } from "./app.js";
import { disconnectPrisma } from "./db/prisma.js";
import {
  SCHEDULER_LEASE_KEY,
  startAutonomyScheduler,
  stopAutonomyScheduler,
} from "./engines/autonomy-scheduler.js";
import { getKillSwitch } from "./engines/kill-switch.js";
import {
  registerWorkerInstance,
  releaseLease,
  stopWorkerInstance,
} from "./engines/worker-lease.js";
import { getEnv } from "./lib/env.js";

async function main() {
  const env = getEnv();
  const workerId = await registerWorkerInstance("scheduler-worker");
  const app = await buildApp();

  const healthPort = Number(process.env.WORKER_HEALTH_PORT || env.PORT);
  await app.listen({ host: env.HOST, port: healthPort });
  app.log.info(`Faz 5D worker health: http://${env.HOST}:${healthPort}/api/system/health`);
  app.log.info(`Worker id=${workerId}`);

  const kill = await getKillSwitch();
  if (kill.enabled) {
    app.log.warn(
      `Kill switch açık — scheduler tick yeni iş çalıştırmaz. reason=${kill.reason ?? "-"}`,
    );
  }

  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 60_000);
  const { enforceAutonomyWindow } = await import("./engines/autonomy-window.js");
  await enforceAutonomyWindow();
  startAutonomyScheduler(intervalMs);
  app.log.info(`Autonomy scheduler worker başladı (interval=${intervalMs}ms). Cloud live=kapalı.`);

  const shutdown = async (signal: string) => {
    app.log.info(`Worker kapanıyor: ${signal}`);
    stopAutonomyScheduler();
    try {
      await releaseLease(SCHEDULER_LEASE_KEY);
    } catch {
      /* ignore */
    }
    await stopWorkerInstance(`signal:${signal}`);
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  console.error(error);
  try {
    await stopWorkerInstance(`boot_error:${error instanceof Error ? error.message : "unknown"}`);
  } catch {
    /* ignore */
  }
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
