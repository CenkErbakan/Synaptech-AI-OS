import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  AGENT_CAPABILITY_MATRIX,
  assertCapabilityMatrixComplete,
  agentHasCapability,
  AgentWorkResultSchema,
} from "@synaptech/shared";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
process.env.NODE_ENV = "test";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";
process.env.CONTROLLED_AUTONOMY_MODE = "off";
process.env.LOCAL_AGENT_EXECUTION_MODE = "off";

import { verifyAcceptanceIndependently } from "../src/ai/repo/acceptance-verifier.js";
import {
  evaluateAutonomyPolicyRules,
  OWNER_GATED_ACTIONS,
  listAutoAllowedAgents,
} from "../src/engines/autonomy-policy-gate.js";

describe("Kontrollü otonomi — capability matrix", () => {
  it("dokuz ajanı kapsar", () => {
    expect(() => assertCapabilityMatrixComplete()).not.toThrow();
    expect(AGENT_CAPABILITY_MATRIX).toHaveLength(AGENT_IDS.length);
  });

  it("developer sandbox_patch, ads-manager ads_draft yeteneğine sahip", () => {
    expect(agentHasCapability("developer", "sandbox_patch")).toBe(true);
    expect(agentHasCapability("ads-manager", "ads_draft")).toBe(true);
    expect(agentHasCapability("ceo", "sandbox_patch")).toBe(false);
  });
});

describe("Kontrollü otonomi — policy gate", () => {
  beforeEach(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
  });

  it("Owner gated eylemleri reddeder", () => {
    for (const action of ["git_push", "blog_publish", "ad_campaign_launch", "production_deploy"]) {
      const d = evaluateAutonomyPolicyRules({
        agentId: "developer",
        action,
      });
      expect(d.allowed).toBe(false);
      expect(d.requiresOwnerApproval).toBe(true);
      expect(OWNER_GATED_ACTIONS).toContain(action as (typeof OWNER_GATED_ACTIONS)[number]);
    }
  });

  it("doğrulanmamış repo için kod araçlarını engeller", () => {
    const d = evaluateAutonomyPolicyRules({
      agentId: "cto",
      action: "repo_read",
      projectVerifiedRepo: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("unverified_repo_tools_blocked");
  });

  it("sandbox_patch için Docker izolasyonu zorunlu", () => {
    const d = evaluateAutonomyPolicyRules({
      agentId: "developer",
      action: "sandbox_patch",
      projectVerifiedRepo: true,
      sandboxMode: "off",
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("docker_isolation_required");
  });

  it("autoAllowed ajan listesi CEO dahil 9 rol", () => {
    expect(listAutoAllowedAgents().length).toBe(9);
  });
});

describe("Kontrollü otonomi — draft acceptance", () => {
  it("growth-lead yapısal taslağı kabul eder; yayın iddiasını reddeder", () => {
    const ok = AgentWorkResultSchema.parse({
      summary: "Büyüme özeti",
      analysis:
        "Organik ve ürün fırsatları için salt-okunur araştırma taslağı. Yayın veya harcama yapılmaz. Owner onayı gerekir.",
      recommendations: ["SEO brief hazırla"],
      acceptanceMet: true,
      requiresOwnerApproval: true,
      draftKind: "research_brief",
      risks: [],
    });
    const vNoFetch = verifyAcceptanceIndependently({
      agentId: "growth-lead",
      work: ok,
      evidence: [],
      toolsEnabled: false,
    });
    expect(vNoFetch.acceptanceMet).toBe(false);

    const v = verifyAcceptanceIndependently({
      agentId: "growth-lead",
      work: ok,
      evidence: [
        {
          kind: "public_fetch",
          projectSlug: "synaptech",
          path: "https://www.ebso.org.tr/",
          summary: "kamu sayfa",
          trusted: true,
          at: new Date().toISOString(),
        },
      ],
      toolsEnabled: false,
    });
    expect(v.acceptanceMet).toBe(true);
    expect(v.modelAcceptanceIgnored).toBe(true);

    const bad = { ...ok, analysis: ok.analysis + " kampanya başlatıldı ve yayınlandı." };
    const v2 = verifyAcceptanceIndependently({
      agentId: "growth-lead",
      work: bad,
      evidence: [
        {
          kind: "public_fetch",
          projectSlug: "synaptech",
          path: "https://www.ebso.org.tr/",
          summary: "kamu sayfa",
          trusted: true,
          at: new Date().toISOString(),
        },
      ],
      toolsEnabled: false,
    });
    expect(v2.acceptanceMet).toBe(false);
  });

  it("security risks olmadan kabul etmez", () => {
    const work = AgentWorkResultSchema.parse({
      summary: "Güvenlik",
      analysis:
        "Bağımlılık ve secret tarama taslağı. Politika değişmez. Owner onayı olmadan policy update yok.",
      recommendations: ["Dependabot incele"],
      acceptanceMet: true,
      requiresOwnerApproval: true,
      draftKind: "security_risk_review",
      risks: [],
    });
    const v = verifyAcceptanceIndependently({
      agentId: "security",
      work,
      evidence: [],
      toolsEnabled: false,
    });
    expect(v.acceptanceMet).toBe(false);
  });

  it("CTO/developer için toolsiz done olmaz", () => {
    const work = AgentWorkResultSchema.parse({
      summary: "x",
      analysis: "y".repeat(90),
      recommendations: ["a"],
      acceptanceMet: true,
      requiresOwnerApproval: true,
    });
    expect(
      verifyAcceptanceIndependently({
        agentId: "cto",
        work,
        evidence: [],
        toolsEnabled: false,
      }).acceptanceMet,
    ).toBe(false);
    expect(
      verifyAcceptanceIndependently({
        agentId: "developer",
        work,
        evidence: [],
        toolsEnabled: false,
      }).acceptanceMet,
    ).toBe(false);
  });
});

describe("Kontrollü otonomi — tick gate (varsayılan off)", () => {
  it("CONTROLLED_AUTONOMY_MODE varsayılanı off ve continuousAutomation false sözleşmesi", async () => {
    process.env.CONTROLLED_AUTONOMY_MODE = "off";
    const { resetEnvCacheForTests, getEnv } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const env = getEnv();
    expect(env.CONTROLLED_AUTONOMY_MODE).toBe("off");
    expect(env.LOCAL_AGENT_EXECUTION_MODE).toBe("off");
    const { describeAutomationRuntime } = await import("../src/engines/automation-runtime.js");
    const d = describeAutomationRuntime({
      env: env as never,
      killEnabled: false,
      timerActive: true,
    });
    expect(d.continuousAutomation).toBe(false);
    expect(d.reason).toBe("controlled_autonomy_mode_off");
  });
});
