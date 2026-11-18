import { selectDemo, selectReal, DataSourceMixError } from "@synaptech/shared";
import { createDemoDataset } from "@synaptech/shared/demo";
import { describe, expect, it } from "vitest";

describe("DEMO / gerçek ayrımı", () => {
  it("DEMO görevleri selectReal ile reddedilir", () => {
    const demo = createDemoDataset(new Date("2026-11-17T12:00:00.000Z"));
    expect(() => selectReal(demo.tasks, "test")).toThrow(DataSourceMixError);
  });

  it("DEMO görevleri selectDemo ile kabul edilir", () => {
    const demo = createDemoDataset(new Date("2026-11-17T12:00:00.000Z"));
    const selected = selectDemo(demo.tasks, "test");
    expect(selected.every((task) => task.source === "demo")).toBe(true);
  });

  it("gerçek kayıt DEMO seçicisinde reddedilir", () => {
    expect(() =>
      selectDemo([{ id: "1", source: "config" as const }], "test"),
    ).toThrow(DataSourceMixError);
  });
});
