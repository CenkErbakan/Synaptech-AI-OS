import { describe, expect, it } from "vitest";

import { evaluateIdleSkip } from "../src/engines/local-ops-policy.js";
import { shouldNotifyOwner } from "../src/engines/owner-notify.js";
import { diffEnvFileVsRuntime, listEnvFileKeys } from "../src/lib/env-file-keys.js";
import { verifyAcceptanceIndependently } from "../src/ai/repo/acceptance-verifier.js";
import { AgentWorkResultSchema } from "@synaptech/shared";

describe("idle / backoff tetikleri", () => {
  it("plan cooldown 5 dk içinde ikinci planı keser", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 1,
      childOpenCount: 0,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: new Date("2026-11-19T00:04:00.000Z"),
      minIntervalMs: 1_800_000,
      planCooldownMs: 5 * 60_000,
      now: new Date("2026-11-19T00:04:00.000Z"),
    });
    expect(r.reason).toBe("ceo_plan_cooldown");
  });

  it("boş plan backoff", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 0,
      childOpenCount: 0,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: null,
      minIntervalMs: 0,
      planCooldownMs: 60_000,
      lastPlanPersistedChildren: 0,
      now: new Date("2026-11-19T00:02:00.000Z"),
    });
    expect(r.reason).toBe("empty_plan_backoff");
  });
});

describe("Owner notice eşiği", () => {
  it("küçük görev Owner'a gitmez; GitHub yetkisi gider", () => {
    expect(
      shouldNotifyOwner({
        agentId: "cto",
        acceptanceMet: true,
        summary: "yapı incelemesi tamam",
      }),
    ).toBe(false);
    expect(
      shouldNotifyOwner({
        agentId: "ceo",
        acceptanceMet: true,
        summary: "GitHub yetki gerekli: grant yok",
        blockedReason: "owner_grant_required:githubPushDraftPr",
      }),
    ).toBe(true);
  });
});

describe("env anahtar karşılaştırması değer sızdırmaz", () => {
  it("yalnızca key adları", () => {
    const keys = listEnvFileKeys("this-file-does-not-exist.env");
    expect(keys).toEqual([]);
    const d = diffEnvFileVsRuntime({ repoRoot: "C:\\nonexistent-root-synaptech" });
    expect(d.fileFound).toBe(false);
    expect(JSON.stringify(d)).not.toMatch(/password|secret=/i);
  });
});

describe("security açığı iddiası", () => {
  it("yalnızca repo okumak vulnerability done yapmaz", () => {
    const work = AgentWorkResultSchema.parse({
      summary: "kritik güvenlik açığı var",
      analysis: `${"x".repeat(90)}\n vulnerability in auth`,
      recommendations: ["patch"],
      acceptanceMet: true,
      requiresOwnerApproval: true,
      draftKind: "security_risk_review",
      risks: ["auth bypass"],
    });
    const v = verifyAcceptanceIndependently({
      agentId: "security",
      work,
      evidence: [
        {
          kind: "repo_read",
          projectSlug: "synaptech-ai-os",
          path: "apps/api/src/auth.ts",
          summary: "okundu",
          trusted: true,
          at: new Date().toISOString(),
        },
      ],
      toolsEnabled: true,
    });
    expect(v.acceptanceMet).toBe(false);
  });
});
