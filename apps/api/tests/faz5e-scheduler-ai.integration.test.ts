import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(os.tmpdir(), `synaptech-kill-switch-5e-sched-${randomUUID()}.json`);
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
process.env.SCHEDULER_AI_CEO_MODE = "mock";
process.env.SCHEDULER_AI_CEO_MAX_PER_DAY = "20";
process.env.LOCAL_OPS_OPEN_TASK_CAP = "200";
process.env.LOCAL_OPS_CEO_MIN_INTERVAL_MS = "0";
process.env.GITHUB_WRITE_MODE = "off";
process.env.LOCAL_AI_PILOT = "false";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;
const hasDb = Boolean(process.env.DATABASE_URL && ownerToken);

describe.runIf(hasDb)("Faz 5E scheduler AI CEO (mock — gerçek LLM yok)", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
  const suffixA = `test-${randomUUID().slice(0, 8)}`;
  const suffixB = `test-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
    resetModelProviderForTests();
    const { resetWorkerIdForTests } = await import("../src/engines/worker-lease.js");
    resetWorkerIdForTests(`test-sched-ai-${randomUUID().slice(0, 6)}`);
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "faz5e-sched-ai-setup" },
    });
    const { ensureDefaultGoalsAndPolicies } = await import("../src/engines/autonomy-scheduler.js");
    await ensureDefaultGoalsAndPolicies();
  });

  afterAll(async () => {
    process.env.SCHEDULER_AI_CEO_MODE = "off";
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    await app.close();
    const { disconnectPrisma } = await import("../src/db/prisma.js");
    await disconnectPrisma();
  });

  it("otonomi status: deterministic ile AI kanalları ayrı; cloud kapalı", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/autonomy/status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deterministicPlannerAvailable).toBe(true);
    expect(body.schedulerAiCeoMode).toBe("mock");
    expect(body.planner).toBe("mock_llm");
    expect(body.cloudAutoDispatch).toBe(false);
    expect(body.limits.maxPerDay).toBe(20);
    expect(body.continuousAutomation).toBe(false);
    expect(body.automation?.reason).toBeTruthy();
    expect(typeof body.quota?.sources.ceoReal).toBe("number");
    expect(typeof body.quota?.sources.ceoMock).toBe("number");
    expect(body.limits.ceoRealUsed).toBe(body.quota.sources.ceoReal);
    expect(body.limits.runsToday).toBe(body.quota.sources.ceoMock);
    expect(body.schedulerRuntime).toHaveProperty("timerActive");
    expect(body.schedulerRuntime.timerActive).toBe(false);
  });

  it("manuel scheduler tick trigger=manual_api (timer değil)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/autonomy/scheduler/tick",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trigger).toBe("manual_api");
    expect(body.timerDriven).toBe(false);
  });

  it("runScheduledAiCeoCycle: plan doğrular, MSSQL görev + AgentMessage yazar, Cloud yok", async () => {
    const { runScheduledAiCeoCycle } = await import("../src/ai/ai-ceo-scheduler.js");
    const first = await runScheduledAiCeoCycle({ idempotencySuffix: suffixA });
    expect(first.skippedReason).toBeUndefined();
    expect(first.jsonValid).toBe(true);
    expect(first.realAiExecution).toBe(false);
    expect(first.cloudStarted).toBe(false);
    expect(first.parentTaskId).toBeTruthy();
    expect(first.childTaskIds.length).toBeGreaterThanOrEqual(1);
    expect(first.messageIds.length).toBe(first.childTaskIds.length);
    expect(first.archiveCheck.ok).toBe(true);

    const prisma = (await import("../src/db/prisma.js")).getPrisma();
    const parent = await prisma.task.findUnique({ where: { id: first.parentTaskId! } });
    expect(parent?.model).toBe("mock-ceo-v1");
    expect(parent?.status).not.toBe("done");
    const child = await prisma.task.findUnique({ where: { id: first.childTaskIds[0]! } });
    expect(child?.parentTaskId).toBe(first.parentTaskId);
    expect(child?.executionResult).toBeTruthy();
    expect(child?.status).toBe("planned"); // tamamlandı sayılmaz

    const msg = await prisma.agentMessage.findUnique({ where: { id: first.messageIds[0]! } });
    expect(msg?.fromAgentId).toBe("ceo");
    expect(msg?.kind).toBe("handoff");
  });

  it("aynı idempotency ile ikinci çağrı model tekrar üretmez", async () => {
    const { runScheduledAiCeoCycle } = await import("../src/ai/ai-ceo-scheduler.js");
    const again = await runScheduledAiCeoCycle({ idempotencySuffix: suffixA });
    expect(again.skippedReason).toBe("idempotent_cycle_exists");
    expect(again.parentTaskId).toBeTruthy();
  });

  it("kill switch yeni AI CEO çalıştırmasını engeller", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: true, reason: "faz5e-sched-ai-kill" },
    });
    const { runScheduledAiCeoCycle } = await import("../src/ai/ai-ceo-scheduler.js");
    await expect(runScheduledAiCeoCycle({ idempotencySuffix: suffixB })).rejects.toMatchObject({
      statusCode: 423,
    });
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "faz5e-sched-ai-unkill" },
    });
  });

  it("local erişilemezken mock'a düşmez (MODE=local + bozuk URL)", async () => {
    process.env.SCHEDULER_AI_CEO_MODE = "local";
    process.env.MODEL_PROVIDER = "local";
    process.env.LOCAL_LLM_BASE_URL = "http://127.0.0.1:9";
    process.env.SCHEDULER_AI_CEO_MAX_PER_DAY = "20";
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
    resetModelProviderForTests();

    const { runScheduledAiCeoCycle } = await import("../src/ai/ai-ceo-scheduler.js");
    const skipped = await runScheduledAiCeoCycle({
      idempotencySuffix: `fail-${randomUUID().slice(0, 8)}`,
    });
    // Pencere yoksa local LLM çağrılmaz (mock'a düşmez). 503 yalnızca aktif pencerede Ollama yoksa.
    expect(skipped.realAiExecution).toBe(false);
    expect(skipped.skippedReason).toBe("no_autonomy_window");
    expect(skipped.plan).toBeNull();

    process.env.SCHEDULER_AI_CEO_MODE = "mock";
    process.env.MODEL_PROVIDER = "mock";
    process.env.SCHEDULER_AI_CEO_MAX_PER_DAY = "20";
    delete process.env.LOCAL_LLM_BASE_URL;
    resetEnvCacheForTests();
    resetModelProviderForTests();
  });

  it("komuta merkezi ve yetki kapıları — dış işlem kapalı", async () => {
    const center = await app.inject({
      method: "GET",
      url: "/api/ops/command-center",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(center.statusCode).toBe(200);
    const body = center.json();
    expect(body.company.cloudFallback).toBe(false);
    expect(body.grants.values.githubPushDraftPr).toBe(false);
    expect(body.grants.values.customerOutreach).toBe(false);
    expect(body.llm.concurrentMax).toBe(1);

    const grants = await app.inject({
      method: "GET",
      url: "/api/ops/grants",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(grants.statusCode).toBe(200);
    expect(grants.json().values.productionDeploy).toBe(false);
  });
});

describe("Faz 5E plan grounding (unit)", () => {
  it("yalnızca proje slug eşleşmesini verified saymaz", async () => {
    const { validateAndGroundPlanTasks } = await import("../src/ai/plan-grounding.js");
    // DB yoksa skip — hasDb ile aynı koşul
    if (!hasDb) return;
    const { ensureDefaultGoalsAndPolicies } = await import("../src/engines/autonomy-scheduler.js");
    await ensureDefaultGoalsAndPolicies();
    const result = await validateAndGroundPlanTasks({
      summary: "test",
      goalsAddressed: [],
      tasks: [
        {
          title: "Slug only task",
          description: "desc",
          projectSlug: "synaptech-ai-os",
          assigneeId: "cto",
          priority: "medium",
          acceptanceCriteria: "ok",
          evidenceHint: "sadece-metin-kanit-degil",
        },
      ],
      risks: [],
      requiresOwnerApproval: true,
      estimatedAiCost: "none",
    });
    expect(result.accepted.length).toBe(0);
    expect(result.unverified.length).toBe(1);
    expect(result.unverified[0]?.verified).toBe(false);
  });
});
