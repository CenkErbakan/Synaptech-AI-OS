import { describe, expect, it } from "vitest";

import { selectDemo, selectReal } from "@synaptech/shared";
import { createDemoDataset } from "@synaptech/shared/demo";

describe("DEMO / Gerçek izolasyon", () => {
  it("DEMO görevleri gerçek seçicide reddedilir", () => {
    const dataset = createDemoDataset(new Date("2026-11-17T12:00:00.000Z"));
    expect(() => selectReal(dataset.tasks, "test")).toThrow(/DEMO/);
  });

  it("DEMO seçici yalnızca demo kaynağını kabul eder", () => {
    const dataset = createDemoDataset(new Date("2026-11-17T12:00:00.000Z"));
    const demo = selectDemo(dataset.tasks, "test");
    expect(demo.every((task) => task.source === "demo")).toBe(true);
  });
});
