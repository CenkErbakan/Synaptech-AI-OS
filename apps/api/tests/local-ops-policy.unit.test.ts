import { describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
process.env.NODE_ENV = "test";

import { evaluateBackoff, evaluateIdleSkip, nextBackoffMs } from "../src/engines/local-ops-policy.js";
import { evaluateGithubWrite } from "../src/engines/github-write-adapter.js";
import { parseLeadCrm, embedLeadCrm, qualifyPublicLead } from "../src/engines/crm-lead.js";
import { DEFAULT_OWNER_GRANTS } from "../src/engines/owner-grants.js";

describe("yerel operasyon — boşta iş uydurma", () => {
  it("kuyruk tavanında skip", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 48,
      queueCap: 48,
      failedOpenCount: 1,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: null,
      newestAgentResultAt: null,
      minIntervalMs: 1_800_000,
      now: new Date("2026-11-19T00:00:00.000Z"),
    });
    expect(r).toEqual({ skip: true, reason: "queue_cap_reached" });
  });

  it("açık child varken yeni plan yok", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 3,
      childOpenCount: 2,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: new Date("2026-11-19T00:05:00.000Z"),
      minIntervalMs: 1_800_000,
      now: new Date("2026-11-19T00:06:00.000Z"),
      starvingProjectCount: 0,
    });
    expect(r.reason).toBe("work_in_flight");
  });

  it("çözülmemiş parent varken yeni plan yok", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 2,
      childOpenCount: 1,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 1,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: new Date("2026-11-19T00:05:00.000Z"),
      minIntervalMs: 0,
      planCooldownMs: 60_000,
      now: new Date("2026-11-19T00:10:00.000Z"),
      starvingProjectCount: 2,
      unresolvedCeoParentCount: 1,
    });
    expect(r.reason).toBe("unresolved_ceo_parent");
  });

  it("aralık içinde yeni kanıt yoksa skip", () => {
    const now = new Date("2026-11-19T00:10:00.000Z");
    const r = evaluateIdleSkip({
      openTaskCount: 1,
      childOpenCount: 0,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: new Date("2026-11-18T23:00:00.000Z"),
      minIntervalMs: 1_800_000,
      planCooldownMs: 60_000,
      now,
    });
    expect(r.reason).toBe("idle_no_new_evidence");
  });

  it("açlık minInterval ve cooldown atlamaz", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 1,
      childOpenCount: 0,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: new Date("2026-11-19T00:00:00.000Z"),
      minIntervalMs: 1_800_000,
      planCooldownMs: 60_000,
      now: new Date("2026-11-19T00:10:00.000Z"),
      starvingProjectCount: 3,
      unresolvedCeoParentCount: 0,
    });
    expect(r.reason).toBe("idle_no_new_evidence");
  });

  it("kuyruk tükenip yeni ajan sonucu varsa CEO çalışır", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 1,
      childOpenCount: 0,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: new Date("2026-11-19T00:05:00.000Z"),
      minIntervalMs: 1_800_000,
      planCooldownMs: 60_000,
      now: new Date("2026-11-19T00:06:00.000Z"),
    });
    expect(r.skip).toBe(false);
  });

  it("backoff artar, 1 saati aşmaz", () => {
    expect(nextBackoffMs(0)).toBe(15_000);
    expect(nextBackoffMs(3)).toBe(120_000);
    expect(nextBackoffMs(20)).toBe(3_600_000);
    const b = evaluateBackoff({
      consecutiveProviderFailures: 2,
      lastFailureAt: new Date("2026-11-19T00:00:00.000Z"),
      now: new Date("2026-11-19T00:00:10.000Z"),
    });
    expect(b.skip).toBe(true);
    expect(b.reason).toBe("provider_backoff");
  });
});

describe("GitHub yazma adaptörü", () => {
  it("Owner grant yoksa push yok", () => {
    const r = evaluateGithubWrite(
      { taskId: "T-1", projectSlug: "subify", verifiedRepo: true },
      DEFAULT_OWNER_GRANTS,
      "mock",
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("owner_grant_required:githubPushDraftPr");
    expect(r.pushed).toBe(false);
  });

  it("grant + mock hazırlar ama push/PR açmaz", () => {
    const r = evaluateGithubWrite(
      { taskId: "T-1", projectSlug: "subify", verifiedRepo: true },
      { ...DEFAULT_OWNER_GRANTS, githubPushDraftPr: true },
      "mock",
    );
    expect(r.allowed).toBe(true);
    expect(r.branch).toBe("ai/T-1");
    expect(r.pushed).toBe(false);
    expect(r.prOpened).toBe(false);
    expect(r.liveNetwork).toBe(false);
  });

  it("doğrulanmamış repoda yazma yok", () => {
    const r = evaluateGithubWrite(
      { taskId: "T-1", projectSlug: "marivo", verifiedRepo: false },
      { ...DEFAULT_OWNER_GRANTS, githubPushDraftPr: true },
      "mock",
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("unverified_repo");
  });
});

describe("GitHub REST kapısı", () => {
  it("main push ve grant yok BLOCKED; ağ yok", async () => {
    const { githubOpPrecheck } = await import("../src/engines/github-rest.js");
    expect(
      githubOpPrecheck({
        op: "push_branch",
        branch: "main",
        writeMode: "live",
        grantOk: true,
        tokenConfigured: true,
      }).reason,
    ).toBe("protected_ref_main_master");
    expect(
      githubOpPrecheck({
        op: "open_draft_pr",
        branch: "ai/T-1",
        writeMode: "off",
        grantOk: true,
        tokenConfigured: true,
      }).reason,
    ).toBe("github_write_mode_off");
  });
});

describe("CRM lead profili", () => {
  it("notes içine gömülür ve ayrıştırılır", () => {
    const notes = embedLeadCrm("aday", { productFit: "subify", outreachConsent: "denied" });
    const crm = parseLeadCrm(notes);
    expect(crm.productFit).toBe("subify");
    expect(crm.outreachConsent).toBe("denied");
    expect(crm.salesStage).toBe("research");
  });

  it("kamuya açık oda kaynağı qualifiedLead=false", () => {
    const q = qualifyPublicLead({
      companyName: "EBSO - Ege Bölgesi Sanayi Odası",
      needSignal: "Sayfada ihtiyaç sinyali: üretim",
      projectSlug: "marivo",
      sourceOk: true,
    });
    expect(q.verifiedSource).toBe(true);
    expect(q.qualifiedLead).toBe(false);
    expect(q.outreachEligible).toBe(false);
    expect(q.productFit).toBe("marivo");
  });
});
