import { describe, expect, it } from "vitest";

import { DEFAULT_LEASE_TTL_MS, getWorkerId, resetWorkerIdForTests } from "../src/engines/worker-lease.js";
import { SCHEDULER_LEASE_KEY, getSchedulerRuntimeStatus } from "../src/engines/autonomy-scheduler.js";

describe("Faz 5D worker lease unit", () => {
  it("lease TTL 30 saniyedir", () => {
    expect(DEFAULT_LEASE_TTL_MS).toBe(30_000);
  });

  it("scheduler lease anahtarı sabittir", () => {
    expect(SCHEDULER_LEASE_KEY).toBe("scheduler:tick");
  });

  it("WORKER_ID env ile sabitlenir", () => {
    resetWorkerIdForTests();
    process.env.WORKER_ID = "unit-worker-a";
    resetWorkerIdForTests();
    expect(getWorkerId()).toBe("unit-worker-a");
    resetWorkerIdForTests("unit-worker-b");
    expect(getWorkerId()).toBe("unit-worker-b");
    delete process.env.WORKER_ID;
    resetWorkerIdForTests();
  });

  it("runtime status şekli tutarlıdır", () => {
    const s = getSchedulerRuntimeStatus();
    expect(s).toHaveProperty("timerActive");
    expect(s).toHaveProperty("leaseKey", SCHEDULER_LEASE_KEY);
    expect(s).toHaveProperty("workerId");
  });
});
