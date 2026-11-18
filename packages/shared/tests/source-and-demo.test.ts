import { describe, expect, it } from "vitest";

import { createDemoDataset } from "../src/demo/seed";
import { taskHistoryToActivity } from "../src/domain/activity";
import { APPROVAL_TYPES, ApprovalRequestSchema, effectiveApprovalStatus } from "../src/domain/approvals";
import { AuditEventSchema, auditEventToActivity } from "../src/domain/audit";
import { DataSourceMixError, selectDemo, selectReal } from "../src/domain/source";
import { TaskSchema } from "../src/domain/tasks";
import { NOW } from "./helpers";

describe("veri kaynağı ayrımı", () => {
  it("selectReal tek bir DEMO kaydında bile hata fırlatır", () => {
    expect(() => selectReal([{ source: "config" }, { source: "demo" }], "test")).toThrow(DataSourceMixError);
    expect(selectReal([{ source: "config" }, { source: "cursor-hook" }])).toHaveLength(2);
  });

  it("selectDemo gerçek kaydı reddeder", () => {
    expect(() => selectDemo([{ source: "demo" }, { source: "cursor-hook" }])).toThrow(DataSourceMixError);
    expect(selectDemo([{ source: "demo" }])).toHaveLength(1);
  });

  it("hook denetim kaydından türeyen olaylar gerçek kaynak taşır ve selectReal'dan geçer", () => {
    const event = AuditEventSchema.parse({
      v: 1,
      ts: NOW.toISOString(),
      event: "beforeShellExecution",
      decision: "deny",
      category: "git-push",
      target: "git push",
    });
    const activity = auditEventToActivity(event, 0);
    expect(activity.source).toBe("cursor-hook");
    expect(selectReal([activity])).toHaveLength(1);
  });
});

describe("DEMO veri seti", () => {
  const dataset = createDemoDataset(NOW);

  it("tüm kayıtlar source: demo taşır ve gerçek seçiciden geçemez", () => {
    const all = [
      ...dataset.tasks,
      ...dataset.approvals,
      ...dataset.activity,
      ...taskHistoryToActivity(dataset.tasks),
      ...Object.values(dataset.growth).flat(),
    ];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((record) => record.source === "demo")).toBe(true);
    expect(() => selectReal(dataset.tasks)).toThrow(DataSourceMixError);
  });

  it("görevler ve onaylar şemaya uyar, kimlikler benzersizdir", () => {
    for (const task of dataset.tasks) expect(TaskSchema.safeParse(task).success).toBe(true);
    for (const approval of dataset.approvals) expect(ApprovalRequestSchema.safeParse(approval).success).toBe(true);
    const ids = dataset.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tüm onay türlerini ve geçersiz (sürümü değişmiş) bir onay örneğini içerir", () => {
    expect(new Set(dataset.approvals.map((approval) => approval.type))).toEqual(new Set(APPROVAL_TYPES));
    expect(dataset.approvals.some((approval) => effectiveApprovalStatus(approval) === "invalidated")).toBe(true);
  });

  it("büyüme verisi uydurma performans metriği alanı içermez", () => {
    const forbiddenKeys = ["volume", "traffic", "clicks", "impressions", "cpc", "ctr", "spend", "conversions", "budgetAmount"];
    const keys = Object.values(dataset.growth)
      .flat()
      .flatMap((item) => Object.keys(item));
    for (const key of forbiddenKeys) expect(keys).not.toContain(key);
  });

  it("onay bekleyen görevlerin bağlı onay kaydı vardır", () => {
    const approvalIds = new Set(dataset.approvals.map((approval) => approval.id));
    for (const task of dataset.tasks.filter((item) => item.status === "awaiting_approval")) {
      expect(task.approvalId && approvalIds.has(task.approvalId)).toBe(true);
    }
  });
});
