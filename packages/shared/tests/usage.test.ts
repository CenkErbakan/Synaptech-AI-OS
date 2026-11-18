import { describe, expect, it } from "vitest";

import { evaluateUsageAlerts, type ManualUsageEntry } from "../src/domain/usage";

const entry = (overrides: Partial<ManualUsageEntry>): ManualUsageEntry => ({
  id: "u1",
  source: "manual",
  date: "2026-11-17",
  cursorModelsPercent: 10,
  otherModelsPercent: 10,
  note: "",
  createdAt: "2026-11-17T10:00:00.000Z",
  ...overrides,
});

describe("evaluateUsageAlerts", () => {
  const thresholds = { warning: 70, critical: 90 };

  it("kayıt yoksa uyarı üretmez", () => {
    expect(evaluateUsageAlerts([], thresholds)).toEqual([]);
  });

  it("yalnızca en son girişe göre uyarı ve kritik seviye üretir", () => {
    const alerts = evaluateUsageAlerts(
      [
        entry({ id: "old", date: "2026-11-01", cursorModelsPercent: 99 }),
        entry({ id: "new", date: "2026-11-17", cursorModelsPercent: 75, otherModelsPercent: 92 }),
      ],
      thresholds,
    );
    expect(alerts.map((alert) => [alert.pool, alert.level])).toEqual([
      ["cursor_models", "warning"],
      ["other_models", "critical"],
    ]);
    expect(alerts.every((alert) => alert.entryId === "new")).toBe(true);
  });

  it("boş bırakılan havuz değerini atlar", () => {
    expect(evaluateUsageAlerts([entry({ cursorModelsPercent: null, otherModelsPercent: null })], thresholds)).toEqual([]);
  });
});
