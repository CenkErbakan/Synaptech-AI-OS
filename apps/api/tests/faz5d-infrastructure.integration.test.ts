import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(os.tmpdir(), `synaptech-kill-switch-5d-${randomUUID()}.json`);
fs.writeFileSync(
  testKillSwitchFile,
  `${JSON.stringify({ enabled: false, reason: null, changedBy: null, changedAt: null }, null, 2)}\n`,
  "utf8",
);
process.env.KILL_SWITCH_FILE = testKillSwitchFile;
process.env.KILL_SWITCH_SKIP_FILE_MIRROR = "true";
process.env.NODE_ENV = "test";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;
const hasDb = Boolean(process.env.DATABASE_URL && ownerToken);

describe.runIf(hasDb)("Faz 5D infrastructure integration", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

  beforeAll(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { resetWorkerIdForTests } = await import("../src/engines/worker-lease.js");
    resetWorkerIdForTests(`faz5d-test-${randomUUID().slice(0, 8)}`);
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "faz5d-setup" },
    });
  });

  afterAll(async () => {
    try {
      await app.inject({
        method: "PATCH",
        url: "/api/system/kill-switch",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { enabled: false, reason: "faz5d-teardown" },
      });
    } catch {
      /* ignore */
    }
    await app.close();
    const { disconnectPrisma } = await import("../src/db/prisma.js");
    await disconnectPrisma();
  });

  it("health scheduler alanını döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/system/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; phase: string; scheduler: { workerId: string } };
    expect(body.ok).toBe(true);
    expect(body.phase).toBe("5D");
    expect(body.scheduler.workerId).toBeTruthy();
  });

  it("lease: ikinci holder aynı lock'u alamaz", async () => {
    const {
      acquireLease,
      releaseLease,
      resetWorkerIdForTests,
    } = await import("../src/engines/worker-lease.js");
    const lockKey = `test:lease:${randomUUID().slice(0, 8)}`;
    resetWorkerIdForTests("holder-a");
    const a = await acquireLease(lockKey, 20_000);
    expect(a.acquired).toBe(true);

    resetWorkerIdForTests("holder-b");
    const b = await acquireLease(lockKey, 20_000);
    expect(b.acquired).toBe(false);
    expect(b.reason).toBe("held_by_other");

    resetWorkerIdForTests("holder-a");
    await releaseLease(lockKey);

    resetWorkerIdForTests("holder-b");
    const c = await acquireLease(lockKey, 20_000);
    expect(c.acquired).toBe(true);
    await releaseLease(lockKey);
  });

  it("süresi dolmuş lease çalınabilir (crash recovery)", async () => {
    const {
      acquireLease,
      releaseLease,
      resetWorkerIdForTests,
      getPrisma,
    } = await import("../src/engines/worker-lease.js").then(async (m) => ({
      ...m,
      getPrisma: (await import("../src/db/prisma.js")).getPrisma,
    }));
    const lockKey = `test:expired:${randomUUID().slice(0, 8)}`;
    resetWorkerIdForTests("crashed-worker");
    const first = await acquireLease(lockKey, 60_000);
    expect(first.acquired).toBe(true);

    const prisma = getPrisma();
    await prisma.workerLease.update({
      where: { lockKey },
      data: { expiresAt: new Date(Date.now() - 5_000) },
    });

    resetWorkerIdForTests("recovery-worker");
    const recovered = await acquireLease(lockKey, 20_000);
    expect(recovered.acquired).toBe(true);
    expect(recovered.holderId).toBe("recovery-worker");
    await releaseLease(lockKey);
  });

  it("kill switch scheduler tick'i durdurur", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: true, reason: "faz5d-kill-test" },
    });
    const tick = await app.inject({
      method: "POST",
      url: "/api/autonomy/scheduler/tick",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(tick.statusCode).toBe(200);
    const body = tick.json() as { skipped: string[] };
    expect(body.skipped).toContain("kill_switch");

    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "faz5d-kill-off" },
    });
  });

  it("scheduler API Cloud live kapalı olduğunu doğrular", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/system/scheduler",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cloudLive: boolean; phase: string };
    expect(body.phase).toBe("5D");
    expect(body.cloudLive).toBe(false);
  });

  it("ScheduledJob kalıcıdır (ensure upsert)", async () => {
    const { ensureDefaultAutonomyJobs } = await import("../src/engines/autonomy-scheduler.js");
    await ensureDefaultAutonomyJobs();
    const { getPrisma } = await import("../src/db/prisma.js");
    const jobs = await getPrisma().scheduledJob.findMany();
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    const keys = new Set(jobs.map((j) => j.jobKey));
    expect(keys.has("daily-ceo-review")).toBe(true);
  });
});
