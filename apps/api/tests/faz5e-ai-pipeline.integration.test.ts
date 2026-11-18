import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(os.tmpdir(), `synaptech-kill-switch-5e-${randomUUID()}.json`);
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
process.env.MODEL_PROVIDER = "mock";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;
const hasDb = Boolean(process.env.DATABASE_URL && ownerToken);

describe.runIf(hasDb)("Faz 5E AI pipeline (mock)", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

  beforeAll(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
    resetModelProviderForTests();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "faz5e-setup" },
    });
  });

  afterAll(async () => {
    await app.close();
    const { disconnectPrisma } = await import("../src/db/prisma.js");
    await disconnectPrisma();
  });

  it("AI status: Cloud ModelProvider değil; faz5eCompleteClaim=false", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ai/status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.faz5eCompleteClaim).toBe(false);
    expect(body.cursorCloud.isModelProvider).toBe(false);
    expect(body.cursorCloud.autoDispatchAllowed).toBe(false);
    expect(body.modelProvider.realAiAvailable).toBe(false);
  });

  it("mock pipeline: plan doğrulanır, realAiExecution=false, Cloud başlatılmaz", async () => {
    const { ensureDefaultGoalsAndPolicies } = await import("../src/engines/autonomy-scheduler.js");
    await ensureDefaultGoalsAndPolicies();
    const { scanOpportunities } = await import("../src/engines/opportunity-engine.js");
    await scanOpportunities();

    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ceo/pipeline",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { forceChannel: "mock_llm" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.realAiExecution).toBe(false);
    expect(body.channel).toBe("mock_llm");
    expect(body.cloudGate.cloudAutoDispatchAllowed).toBe(false);
    if (!body.blockedReason || body.blockedReason === "duplicate_chain_prevented") {
      // plan veya mevcut zincir — ikisi de kabul
      expect(body.plan || body.parentTaskId).toBeTruthy();
    } else if (body.plan) {
      expect(body.plan.tasks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("CEO chat mock etiketi taşır", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/coordination/ceo-chat/message",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { message: "hedefler neler?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.realAiExecution).toBe(false);
    expect(body.llmIntegrated).toBe(false);
    expect(String(body.reply)).toMatch(/Mock|Deterministik|gerçek LLM/i);
  });

  it("growth AI hook publish kapalı", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ai/growth-hooks",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.publishAllowed).toBe(false);
    expect(body.customerMessageAllowed).toBe(false);
  });
});
