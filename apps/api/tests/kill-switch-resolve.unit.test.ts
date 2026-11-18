import { describe, expect, it } from "vitest";

import { mergeKillSwitchSources } from "../src/engines/kill-switch.js";
import { epochActivityFilter, isInCurrentEpoch } from "../src/engines/operation-epoch.js";

describe("kill switch fail-safe", () => {
  it("DB açık dosya kapalı → otonomi kapalı", () => {
    const r = mergeKillSwitchSources(
      { enabled: true, reason: "reset", changedBy: "Owner", changedAt: "2026-11-18T19:56:00Z" },
      { enabled: false, reason: "integration-test", changedBy: "Owner", changedAt: "2026-11-17T16:34:22Z" },
    );
    expect(r.enabled).toBe(true);
    expect(r.conflict).toBe(true);
    expect(r.source).toBe("fail_safe_or");
  });

  it("DB kapalı dosya açık → otonomi kapalı", () => {
    const r = mergeKillSwitchSources(
      { enabled: false, reason: null, changedBy: null, changedAt: null },
      { enabled: true, reason: "hooks", changedBy: "Owner", changedAt: null },
    );
    expect(r.enabled).toBe(true);
    expect(r.conflict).toBe(true);
  });

  it("ikisi kapalı → otonomi serbest (kill kapalı)", () => {
    const r = mergeKillSwitchSources(
      { enabled: false, reason: null, changedBy: null, changedAt: null },
      { enabled: false, reason: null, changedBy: null, changedAt: null },
    );
    expect(r.enabled).toBe(false);
    expect(r.conflict).toBe(false);
    expect(r.source).toBe("database");
  });
});

describe("epoch activity filter", () => {
  it("eski createdAt düşer", () => {
    const after = new Date("2026-11-18T19:56:44.786Z");
    expect(isInCurrentEpoch(new Date("2026-11-18T18:00:00Z"), after)).toBe(false);
    expect(isInCurrentEpoch(new Date("2026-11-18T20:00:00Z"), after)).toBe(true);
    const f = epochActivityFilter(after);
    expect(f).toHaveProperty("OR");
  });
});
