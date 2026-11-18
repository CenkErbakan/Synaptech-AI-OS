import { buildApp } from "./app.js";
import { disconnectPrisma } from "./db/prisma.js";
import {
  SCHEDULER_LEASE_KEY,
  startAutonomyScheduler,
  stopAutonomyScheduler,
} from "./engines/autonomy-scheduler.js";
import {
  registerWorkerInstance,
  releaseLease,
  stopWorkerInstance,
} from "./engines/worker-lease.js";
import { getEnv } from "./lib/env.js";

async function main() {
  // WORKER_MODE=1 → yalnızca worker girişi (IDE bağımsız süreç)
  if (process.env.WORKER_MODE === "1" || process.env.WORKER_MODE === "true") {
    await import("./worker.js");
    return;
  }

  const env = getEnv();
  const app = await buildApp();
  const embedScheduler = process.env.EMBED_SCHEDULER !== "0";
  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(`SynapTech API dinliyor: http://${env.HOST}:${env.PORT}`);
    app.log.info(`OpenAPI: http://${env.HOST}:${env.PORT}/api/docs`);
    if (embedScheduler) {
      await registerWorkerInstance("api-embedded-scheduler");
      const { enforceAutonomyWindow } = await import("./engines/autonomy-window.js");
      await enforceAutonomyWindow();
      startAutonomyScheduler(Number(process.env.SCHEDULER_INTERVAL_MS || 60_000));
      app.log.info("Autonomy scheduler başlatıldı (lease korumalı; Cloud create yok).");
    } else {
      app.log.info("EMBED_SCHEDULER=0 — API yalnızca HTTP; ayrı worker bekleniyor.");
    }
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const shutdown = async () => {
    stopAutonomyScheduler();
    if (embedScheduler) {
      try {
        await releaseLease(SCHEDULER_LEASE_KEY);
      } catch {
        /* ignore */
      }
      await stopWorkerInstance("api_shutdown").catch(() => undefined);
    }
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main();
