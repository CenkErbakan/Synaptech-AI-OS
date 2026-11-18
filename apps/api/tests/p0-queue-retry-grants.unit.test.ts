import { describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
process.env.NODE_ENV = "test";

import { evaluateIdleSkip } from "../src/engines/local-ops-policy.js";
import { classifyParentFromChildren } from "../src/engines/parent-task-lifecycle.js";
import { retryBudgetExhausted, parseOwnerRetryRemaining, withOwnerRetryRemaining } from "../src/ai/retry-budget.js";
import { claimsActiveDefect, classifyCtoContract } from "../src/ai/cto-finding.js";
import { decidePersistableTasks } from "../src/ai/portfolio-eval.js";
import { verifyAcceptanceIndependently } from "../src/ai/repo/acceptance-verifier.js";
import { AgentWorkResultSchema } from "@synaptech/shared";
import { listGrantRuntimeMismatches } from "../src/engines/grant-runtime-alignment.js";
import { DEFAULT_OWNER_GRANTS } from "../src/engines/owner-grants.js";

const idleBase = {
  openTaskCount: 3,
  childOpenCount: 0,
  queueCap: 48,
  failedOpenCount: 0,
  pendingOwnerDecisionCount: 0,
  lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
  newestAgentResultAt: new Date("2026-11-19T00:02:00.000Z"),
  minIntervalMs: 1_800_000,
  planCooldownMs: 5 * 60_000,
  now: new Date("2026-11-19T00:04:00.000Z"),
  starvingProjectCount: 2,
  unresolvedCeoParentCount: 0,
};

describe("P0 CEO kuyruk", () => {
  it("parent çözülmeden 4 dk sonra yeni plan yok (cooldown)", () => {
    const r = evaluateIdleSkip({ ...idleBase, unresolvedCeoParentCount: 1, childOpenCount: 2 });
    expect(r.reason).toBe("unresolved_ceo_parent");
  });

  it("üç parent üst üste: cooldown keser", () => {
    const r = evaluateIdleSkip({
      ...idleBase,
      unresolvedCeoParentCount: 0,
      childOpenCount: 0,
      now: new Date("2026-11-19T00:04:00.000Z"),
    });
    expect(r.reason).toBe("ceo_plan_cooldown");
  });

  it("kuyruk dolu LLM yok", () => {
    const r = evaluateIdleSkip({ ...idleBase, openTaskCount: 48, queueCap: 48 });
    expect(r.reason).toBe("queue_cap_reached");
  });

  it("ceo_event_pending cooldown atlamaz", () => {
    const r = evaluateIdleSkip({ ...idleBase, ceoEventPending: true, unresolvedCeoParentCount: 0 });
    expect(r.reason).toBe("ceo_plan_cooldown");
  });
});

describe("P0 parent kapanış", () => {
  it("hepsi done → parent done", () => {
    expect(classifyParentFromChildren([{ status: "done" }, { status: "done" }]).status).toBe("done");
  });

  it("kısmi: done + failed → blocked", () => {
    const r = classifyParentFromChildren([{ status: "done" }, { status: "failed" }]);
    expect(r.status).toBe("blocked");
    expect(r.blockedReason).toBe("partial_child_failure");
  });

  it("Owner kararı bekler", () => {
    const r = classifyParentFromChildren([{ status: "done" }, { status: "awaiting_approval" }]);
    expect(r.blockedReason).toBe("waiting_owner_decision");
  });
});

describe("P0 retry / approval", () => {
  it("attempts sıfırlanmaz; bütçe dolu", () => {
    expect(retryBudgetExhausted({ spentProviderCalls: 3, maxRetries: 2, ownerRetryRemaining: 0 })).toBe(true);
    expect(retryBudgetExhausted({ spentProviderCalls: 2, maxRetries: 2, ownerRetryRemaining: 0 })).toBe(false);
    expect(parseOwnerRetryRemaining("AUTO")).toBe(0);
    expect(parseOwnerRetryRemaining(withOwnerRetryRemaining("AUTO", 1))).toBe(1);
  });

  it("Owner retry hakkı yoksa yeniden yürütme yok", () => {
    expect(retryBudgetExhausted({ spentProviderCalls: 3, maxRetries: 2, ownerRetryRemaining: 0 })).toBe(true);
    expect(retryBudgetExhausted({ spentProviderCalls: 3, maxRetries: 2, ownerRetryRemaining: 1 })).toBe(false);
    expect(retryBudgetExhausted({ spentProviderCalls: 0, maxRetries: 0, ownerRetryRemaining: 0 })).toBe(false);
  });
});

describe("P0 CTO findingKind=none", () => {
  it("borç bulunamadı active defect değildir", () => {
    expect(
      claimsActiveDefect("Teknik borç analizi yapıldı. Herhangi bir teknik borç bulunamadı."),
    ).toBe(false);
  });

  it("kalite görevi inspection_ok", () => {
    expect(classifyCtoContract("Kalite kontrol ve yapı incelemesi", "Subify kalite kontrolü")).toBe(
      "inspection_ok",
    );
    expect(classifyCtoContract("verified_defect kanıtı zorunlu", "bug")).toBe("verified_defect_required");
  });

  it("none + inspection sözleşme done olmaz; 2 yol + structure kabul", () => {
    const work = AgentWorkResultSchema.parse({
      summary: "Yapı incelendi, borç bulunamadı",
      analysis: `${"x".repeat(90)}\nSubtitle.sln\nfrontend/package.json`,
      recommendations: ["izlemeye devam"],
      acceptanceMet: true,
      findingKind: "structure_inspection",
    });
    const v = verifyAcceptanceIndependently({
      agentId: "cto",
      work,
      evidence: [
        {
          kind: "repo_read",
          projectSlug: "subify",
          path: "Subtitle.sln",
          summary: "ok",
          trusted: true,
          at: new Date().toISOString(),
        },
        {
          kind: "repo_read",
          projectSlug: "subify",
          path: "frontend/package.json",
          summary: "ok",
          trusted: true,
          at: new Date().toISOString(),
        },
      ],
      toolsEnabled: true,
      ctoContract: "inspection_ok",
    });
    expect(v.acceptanceMet).toBe(true);
  });
});

describe("P0 persist dedupe", () => {
  it("aynı proje+ajan açık işi tekrar yazmaz", () => {
    const task = {
      title: "Subify kalite 2",
      description: "x",
      projectSlug: "subify" as const,
      assigneeId: "cto" as const,
      priority: "high" as const,
      acceptanceCriteria: "y",
      evidenceHint: "mssql:Task",
    };
    const { drops } = decidePersistableTasks({
      items: [{ task, ok: true }],
      selectedSlugs: ["subify"],
      remainingSlots: 5,
      isDuplicateTitle: () => false,
      isDuplicateWork: (t) => t.projectSlug === "subify" && t.assigneeId === "cto",
    });
    expect(drops[0]?.reasonCode).toBe("duplicate_open_title");
  });
});

describe("P0 grant / runtime", () => {
  it("grant true mode off mismatch", () => {
    const m = listGrantRuntimeMismatches({
      grants: {
        ...DEFAULT_OWNER_GRANTS,
        githubPushDraftPr: true,
        githubRepoCreate: true,
        customerOutreach: true,
        productionDeploy: true,
      },
      githubWriteMode: "off",
      cloudLiveEnabled: false,
    });
    expect(m.map((x) => x.grantKey).sort()).toEqual(
      ["customerOutreach", "githubPushDraftPr", "githubRepoCreate", "productionDeploy"].sort(),
    );
  });

  it("kapalı grant mismatch yok", () => {
    const m = listGrantRuntimeMismatches({
      grants: DEFAULT_OWNER_GRANTS,
      githubWriteMode: "off",
      cloudLiveEnabled: false,
    });
    expect(m).toEqual([]);
  });
});
