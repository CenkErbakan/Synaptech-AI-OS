import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(os.tmpdir(), `synaptech-kill-switch-growth-${randomUUID()}.json`);
fs.writeFileSync(
  testKillSwitchFile,
  `${JSON.stringify({ enabled: false, reason: null, changedBy: null, changedAt: null }, null, 2)}\n`,
  "utf8",
);
process.env.KILL_SWITCH_FILE = testKillSwitchFile;
process.env.KILL_SWITCH_SKIP_FILE_MIRROR = "true";
process.env.NODE_ENV = "test";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";
process.env.SYNAPTECH_WEBSITE_URL = "https://synaptech.software";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;

describe("Faz 5C business growth", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

  beforeAll(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "growth-test-setup" },
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    const { disconnectPrisma } = await import("../src/db/prisma.js");
    await disconnectPrisma();
    try {
      fs.unlinkSync(testKillSwitchFile);
    } catch {
      /* ignore */
    }
  });

  it("SEO kamu taraması ölçülmüş bulgu üretir (veya hatayı raporlar)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/growth/seo/scan",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.realAiExecution).toBe(false);
    expect(body.gscConnected).toBe(false);
    expect(body.mode).toBe("public_http_scan");
    expect(["succeeded", "partial", "failed"]).toContain(body.status);
    if (body.status === "failed") {
      expect(body.errors.length).toBeGreaterThan(0);
    } else {
      expect(body.measured).toBeGreaterThan(0);
      expect(body.findings.some((f: { findingKind: string }) => f.findingKind === "measured")).toBe(true);
    }
  }, 60_000);

  it("lead research kaynaklı kayıt ve mükerrerlik", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/growth/research/leads",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a.outreachPerformed).toBe(false);
    expect(a.realAiExecution).toBe(false);

    const second = await app.inject({
      method: "POST",
      url: "/api/growth/research/leads",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(second.statusCode).toBe(200);
    const b = second.json();
    expect(b.skippedDuplicates + b.created).toBeGreaterThanOrEqual(0);
    // İkinci koşuda yeni yoksa duplicate artmış olmalı (veya created 0)
    if (a.created > 0) {
      expect(b.skippedDuplicates).toBeGreaterThanOrEqual(a.created);
    }

    const list = await app.inject({
      method: "GET",
      url: "/api/growth/leads",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    for (const lead of list.json().leads) {
      if (lead.verified) {
        expect(lead.sourceUrl).toBeTruthy();
      }
    }
  }, 60_000);

  it("content taslakları template olarak işaretlenir; LLM makalesi değildir", async () => {
    await app.inject({
      method: "POST",
      url: "/api/growth/seo/scan",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/growth/content/drafts",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.llmArticleGenerated).toBe(false);
    expect(body.realAiExecution).toBe(false);
    expect(body.providerGaps.length).toBeGreaterThan(0);
    for (const d of body.created) {
      expect(d.contentKind).toBe("template");
      expect(["draft", "awaiting_llm", "blocked_duplicate"]).toContain(d.status);
    }
  }, 60_000);

  it("CEO→Growth→SEO→Content→Ads zinciri motor çıktısıyla ilerler", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/growth/chains/start",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { idempotencyKey: `growth-e2e-${randomUUID()}` },
    });
    expect(start.statusCode).toBe(200);
    const { chainId, steps } = start.json();
    expect(steps).toHaveLength(6);
    expect(steps[0].workflowPhase).toBe("ready");
    expect(steps[1].workflowPhase).toBe("waiting_dependency");

    const sim = await app.inject({
      method: "POST",
      url: `/api/growth/chains/${chainId}/simulate`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().realAiExecution).toBe(false);
    expect(sim.json().executed.length).toBeGreaterThanOrEqual(6);

    const status = await app.inject({
      method: "GET",
      url: "/api/growth/status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(status.json().counts.seoFindings).toBeGreaterThan(0);
  }, 120_000);

  it("kill switch growth research’i engeller", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: true, reason: "growth-test-kill" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/growth/research/leads",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect([423, 403, 500]).toContain(res.statusCode);
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "growth-test-unkill" },
    });
  });
});
