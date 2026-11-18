import { describe, expect, it } from "vitest";

import { deriveAgentStatusFromSignals, deriveAgentStatusFromTasks } from "../src/domain/agent-status";
import { makeTask, NOW } from "./helpers";

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("deriveAgentStatusFromTasks (DEMO)", () => {
  it("devre dışı ajanı her durumda 'disabled' gösterir", () => {
    const tasks = [makeTask({ assignee: "cto", status: "in_progress" })];
    expect(deriveAgentStatusFromTasks("cto", tasks, { enabled: false, now: NOW }).status).toBe("disabled");
  });

  it("kaydı olmayan ajanı 'idle' ve 'no-records' olarak gösterir", () => {
    const result = deriveAgentStatusFromTasks("cto", [], { enabled: true, now: NOW });
    expect(result).toEqual({ status: "idle", basis: "no-records" });
  });

  it("öncelik sırası: çalışıyor > onay bekliyor > hata > tamamlandı", () => {
    const awaiting = makeTask({ id: "a", assignee: "cto", status: "awaiting_approval", updatedAt: minutesAgo(10) });
    const failed = makeTask({ id: "f", assignee: "cto", status: "failed", updatedAt: minutesAgo(1) });
    const working = makeTask({ id: "w", assignee: "cto", status: "in_review", updatedAt: minutesAgo(30) });

    expect(deriveAgentStatusFromTasks("cto", [awaiting, failed, working], { enabled: true, now: NOW }).status).toBe("working");
    expect(deriveAgentStatusFromTasks("cto", [awaiting, failed], { enabled: true, now: NOW }).status).toBe("awaiting_approval");
    expect(deriveAgentStatusFromTasks("cto", [failed], { enabled: true, now: NOW }).status).toBe("error");
  });

  it("durdurulmuş görev ajanı 'çalışıyor' göstermez", () => {
    const paused = makeTask({ assignee: "cto", status: "in_progress", paused: true });
    expect(deriveAgentStatusFromTasks("cto", [paused], { enabled: true, now: NOW }).status).toBe("idle");
  });

  it("24 saat içinde biten görev 'tamamlandı', daha eskisi 'beklemede' gösterilir", () => {
    const recent = makeTask({ assignee: "cto", status: "done", finishedAt: minutesAgo(60), updatedAt: minutesAgo(60) });
    const old = makeTask({ assignee: "cto", status: "done", finishedAt: minutesAgo(3000), updatedAt: minutesAgo(3000) });
    expect(deriveAgentStatusFromTasks("cto", [recent], { enabled: true, now: NOW }).status).toBe("completed");
    expect(deriveAgentStatusFromTasks("cto", [old], { enabled: true, now: NOW }).status).toBe("idle");
  });
});

describe("deriveAgentStatusFromSignals (gerçek)", () => {
  it("hook kaydı yoksa tanım dosyası olsa bile 'çalışıyor' göstermez", () => {
    const result = deriveAgentStatusFromSignals("cto", { enabled: true, activeSubagents: [] }, NOW);
    expect(result).toEqual({ status: "idle", basis: "no-records" });
  });

  it("aktif alt ajan oturumu varsa 'çalışıyor' gösterir", () => {
    const result = deriveAgentStatusFromSignals(
      "cto",
      { enabled: true, activeSubagents: [{ type: "cto", startedAt: minutesAgo(2), task: "Plan" }] },
      NOW,
    );
    expect(result.status).toBe("working");
    expect(result.basis).toBe("cursor-hook");
  });

  it("son 24 saatteki hata ve tamamlanma sinyallerini kullanır", () => {
    expect(
      deriveAgentStatusFromSignals("cto", { enabled: true, activeSubagents: [], lastStop: { status: "error", at: minutesAgo(5) } }, NOW).status,
    ).toBe("error");
    expect(
      deriveAgentStatusFromSignals("cto", { enabled: true, activeSubagents: [], lastStop: { status: "completed", at: minutesAgo(5) } }, NOW).status,
    ).toBe("completed");
    expect(
      deriveAgentStatusFromSignals("cto", { enabled: true, activeSubagents: [], lastStop: { status: "completed", at: minutesAgo(3000) } }, NOW).status,
    ).toBe("idle");
  });
});
