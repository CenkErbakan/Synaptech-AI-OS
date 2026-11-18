import { describe, expect, it } from "vitest";

import { describeAutomationRuntime } from "../src/engines/automation-runtime.js";
import {
  buildAutonomyWindow,
  isAutonomyWindowActive,
  isAutonomyWindowExpired,
  T_P5E_008_LIMITS,
  type AutonomyWindow,
} from "../src/engines/autonomy-window.js";

function windowAt(overrides: Partial<AutonomyWindow>): AutonomyWindow {
  return {
    taskId: "T-P5E-008",
    enabled: true,
    startedAt: "2026-11-18T16:00:00.000Z",
    expiresAt: "2026-11-19T16:00:00.000Z",
    closedAt: null,
    closeReason: null,
    limits: T_P5E_008_LIMITS,
    ...overrides,
  };
}

describe("24s otonomi penceresi (restart dayanıklı sözleşme)", () => {
  it("aktif pencere süre içinde true", () => {
    const w = windowAt({});
    expect(isAutonomyWindowActive(w, new Date("2026-11-19T15:59:59.000Z"))).toBe(true);
    expect(isAutonomyWindowExpired(w, new Date("2026-11-19T15:59:59.000Z"))).toBe(false);
  });

  it("süre dolunca expired — process RAM'e bağlı değil", () => {
    const w = windowAt({});
    expect(isAutonomyWindowExpired(w, new Date("2026-11-19T16:00:00.000Z"))).toBe(true);
    expect(isAutonomyWindowActive(w, new Date("2026-11-19T16:00:00.000Z"))).toBe(false);
  });

  it("pencere yoksa veya disabled ise fail-closed", () => {
    expect(isAutonomyWindowActive(null)).toBe(false);
    expect(isAutonomyWindowActive(windowAt({ enabled: false }))).toBe(false);
  });

  it("24s pencere restart’tan bağımsız expiresAt üretir", () => {
    const w = buildAutonomyWindow({
      taskId: "T-P5E-009",
      now: new Date("2026-11-19T00:00:00.000Z"),
    });
    expect(w.expiresAt).toBe("2026-11-20T00:00:00.000Z");
    expect(w.limits.SCHEDULER_AI_CEO_MAX_PER_DAY).toBe(2);
    expect(w.limits.LOCAL_AGENT_EXECUTION_MAX_PER_DAY).toBe(8);
    expect(w.limits.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY).toBe(2);
    expect(isAutonomyWindowActive(w, new Date("2026-11-19T23:59:59.000Z"))).toBe(true);
    expect(isAutonomyWindowActive(w, new Date("2026-11-20T00:00:00.000Z"))).toBe(false);
  });

  it("pencere yokken env local olsa da continuousAutomation false", () => {
    const env = {
      SCHEDULER_AI_CEO_MODE: "local",
      LOCAL_AGENT_EXECUTION_MODE: "local",
      CONTROLLED_AUTONOMY_MODE: "local",
      CLOUD_AGENT_LIVE_ENABLED: false,
      CURSOR_CLOUD_MODE: "mock",
    } as unknown as import("../src/lib/env.js").Env;
    const d = describeAutomationRuntime({
      env,
      killEnabled: false,
      timerActive: true,
      windowActive: false,
    });
    expect(d.continuousAutomation).toBe(false);
    expect(d.reason).toBe("no_or_expired_autonomy_window");
  });
});
