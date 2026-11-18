import { describe, expect, it } from "vitest";

import {
  DELETE_TABLES,
  PRESERVE_SETTING_KEYS,
  PRESERVE_TABLES,
  classifyLeadRow,
  classifyOpportunityRow,
  unexpectedDboTables,
  buildNewEpoch,
} from "../src/engines/ops-reset.js";

describe("ops-reset sınıflandırma", () => {
  it("korunan tablolar silme listesinde yok", () => {
    for (const t of PRESERVE_TABLES) {
      expect(DELETE_TABLES).not.toContain(t);
    }
    expect(DELETE_TABLES).toContain("Task");
    expect(DELETE_TABLES).toContain("Approval");
    expect(DELETE_TABLES).toContain("AgentMessage");
  });

  it("kill_switch ve grants korunur", () => {
    expect(PRESERVE_SETTING_KEYS.has("kill_switch")).toBe(true);
    expect(PRESERVE_SETTING_KEYS.has("owner_capability_grants")).toBe(true);
    expect(PRESERVE_SETTING_KEYS.has("operation_epoch")).toBe(false);
  });

  it("test/self lead silinir, gerçek müşteri korunur", () => {
    expect(
      classifyLeadRow({ sourceKind: "public_web", status: "new", companyName: "EBSO örnek" }),
    ).toBe("delete_test_or_self");
    expect(
      classifyLeadRow({
        sourceKind: "inbound_sales",
        status: "customer",
        companyName: "Gerçek Müşteri A.Ş.",
      }),
    ).toBe("preserve_customer");
  });

  it("pilot fırsat silinir", () => {
    expect(
      classifyOpportunityRow({ sourceKind: "ceo_scan", title: "Subify kalite" }),
    ).toBe("delete_test_or_self");
  });

  it("bilinmeyen dbo tablosu BLOCKED üretir", () => {
    expect(unexpectedDboTables(["Task", "Invoice", "_prisma_migrations"])).toEqual(["Invoice"]);
  });

  it("yeni epoch eski id taşımaz", () => {
    const e = buildNewEpoch(new Date("2026-11-18T20:00:00.000Z"));
    expect(e.id).toBe("ops-2026-11-18-clean");
    expect(e.previousId).toBeNull();
  });
});
