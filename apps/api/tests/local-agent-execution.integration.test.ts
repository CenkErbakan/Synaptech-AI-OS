import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(
  os.tmpdir(),
  `synaptech-kill-switch-agent-exec-${randomUUID()}.json`,
);
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
process.env.SCHEDULER_AI_CEO_MODE = "off";
process.env.LOCAL_AGENT_EXECUTION_MODE = "mock";
process.env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY = "48";
process.env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY = "24";
process.env.LOCAL_OPS_OPEN_TASK_CAP = "200";
process.env.GITHUB_WRITE_MODE = "off";
process.env.AGENT_SANDBOX_MODE = "off";
process.env.AGENT_REPO_TOOLS_MODE = "off";
process.env.CONTROLLED_AUTONOMY_MODE = "off";
process.env.LOCAL_AI_PILOT = "false";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;
const hasDb = Boolean(process.env.DATABASE_URL && ownerToken);

describe.runIf(hasDb)("Yerel ajan yürütme (mock — gerçek LLM yok)", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
  let parentId = "";
  let ctoTaskId = "";
  let devTaskId = "";

  beforeAll(async () => {
    process.env.LOCAL_AGENT_EXECUTION_MODE = "mock";
    process.env.MODEL_PROVIDER = "mock";
    process.env.SCHEDULER_AI_CEO_MODE = "off";
    process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
    process.env.CURSOR_CLOUD_MODE = "mock";
    process.env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY = "48";
    process.env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY = "24";
    process.env.AGENT_SANDBOX_MODE = "off";
    process.env.AGENT_REPO_TOOLS_MODE = "off";
    process.env.CONTROLLED_AUTONOMY_MODE = "off";
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
    resetModelProviderForTests();
    const { resetWorkerIdForTests } = await import("../src/engines/worker-lease.js");
    resetWorkerIdForTests(`test-agent-exec-${randomUUID().slice(0, 6)}`);
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "agent-exec-setup" },
    });

    const prisma = (await import("../src/db/prisma.js")).getPrisma();
    const project = await prisma.project.findUnique({ where: { slug: "synaptech-ai-os" } });
    if (!project) throw new Error("project_missing");
    parentId = randomUUID();
    ctoTaskId = randomUUID();
    devTaskId = randomUUID();
    const origin = `scheduler-ai-ceo:test-agent-${randomUUID().slice(0, 8)}`;
    const parentKey = `test-agent-parent-${parentId}`;
    await prisma.task.create({
      data: {
        id: parentId,
        source: "real",
        title: `Test parent AI CEO plan ${parentId.slice(0, 8)}`,
        description: "test",
        projectId: project.id,
        assigneeId: "ceo",
        priority: "high",
        status: "planned",
        dispatchState: "ready",
        executionPolicy: "AUTO",
        origin,
        executionKind: "real_ai_pending",
        model: "mock-ceo-v1",
        idempotencyKey: parentKey,
      },
    });
    await prisma.task.create({
      data: {
        id: ctoTaskId,
        source: "real",
        title: `CTO teknik inceleme ${ctoTaskId.slice(0, 8)}`,
        description: "Mock CTO görevi",
        projectId: project.id,
        assigneeId: "cto",
        priority: "high",
        status: "planned",
        dispatchState: "ready",
        executionPolicy: "AUTO",
        origin,
        parentTaskId: parentId,
        executionKind: "real_ai_pending",
        acceptanceCriteria: "Teknik risk notu yazılmış olmalı",
        idempotencyKey: `test-cto-${ctoTaskId}`,
      },
    });
    await prisma.task.create({
      data: {
        id: devTaskId,
        source: "real",
        title: `Developer uygulama önerisi ${devTaskId.slice(0, 8)}`,
        description: "Mock Developer görevi",
        projectId: project.id,
        assigneeId: "developer",
        priority: "medium",
        status: "planned",
        dispatchState: "ready",
        executionPolicy: "AUTO",
        origin,
        parentTaskId: parentId,
        executionKind: "real_ai_pending",
        acceptanceCriteria: "Kod önerisi üretilmeli; dosya değişmemeli",
        idempotencyKey: `test-dev-${devTaskId}`,
      },
    });
  }, 60_000);

  afterAll(async () => {
    process.env.LOCAL_AGENT_EXECUTION_MODE = "off";
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    if (app) await app.close();
    const { disconnectPrisma } = await import("../src/db/prisma.js");
    await disconnectPrisma();
  }, 30_000);

  it("execution-status: mode/mock ayrımı ve continuousAutomation=false", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ai/agents/execution-status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("mock");
    expect(body.continuousAutomation).toBe(false);
    expect(body.cloudAutoDispatch).toBe(false);
  });

  it("mock pass: CTO+Developer çıktı yazar, completed olmaz, codeChangeApplied=false, Cloud yok", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/agents/execute",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        limit: 2,
        taskIds: [ctoTaskId, devTaskId],
        agentIds: ["cto", "developer"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.continuousAutomation).toBe(false);
    expect(body.cloudStarted).toBe(false);
    expect(body.processed.length).toBe(2);

    for (const item of body.processed) {
      expect(item.realAiExecution).toBe(false);
      expect(item.channel).toBe("mock_llm");
      expect(item.codeChangeApplied).toBe(false);
      expect(item.acceptanceMet).toBe(false);
      expect(item.status).toBe("planned"); // acceptanceMet false → done değil
      expect(item.isDepartmentHandoff).toBe(false);
    }

    const prisma = (await import("../src/db/prisma.js")).getPrisma();
    const cto = await prisma.task.findUnique({ where: { id: ctoTaskId } });
    expect(cto?.executionKind).toBe("mock_llm");
    expect(cto?.model).toContain("mock-agent");
    expect(cto?.executionResult).toContain("realAiExecution");
    expect(cto?.status).toBe("planned");
    const msg = await prisma.agentMessage.findFirst({
      where: { taskId: ctoTaskId, kind: "result" },
    });
    expect(msg?.fromAgentId).toBe("cto");
    expect(msg?.toAgentId).toBe("ceo");
  });

  it("aynı görev ikinci worker ile lease/çift yürütme engellenir veya tekrar güvenli", async () => {
    const { executeOneLocalAgentTask } = await import("../src/ai/local-agent-execution.js");
    const { acquireTaskExecutionLease, releaseTaskExecutionLease } = await import(
      "../src/ai/llm-call-guard.js"
    );
    const { resetWorkerIdForTests } = await import("../src/engines/worker-lease.js");
    resetWorkerIdForTests("worker-holder-a");
    const held = await acquireTaskExecutionLease(ctoTaskId, 60_000);
    expect(held.acquired).toBe(true);
    resetWorkerIdForTests("worker-holder-b");
    const blocked = await executeOneLocalAgentTask(ctoTaskId, "mock");
    expect(blocked.skippedReason).toMatch(/task_lease_held/);
    resetWorkerIdForTests("worker-holder-a");
    await releaseTaskExecutionLease(ctoTaskId);
  });

  it("local erişilemezken mock'a düşmez", async () => {
    process.env.LOCAL_AGENT_EXECUTION_MODE = "local";
    process.env.MODEL_PROVIDER = "local";
    process.env.LOCAL_LLM_BASE_URL = "http://127.0.0.1:9";
    process.env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY = "20";
    process.env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY = "40";
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
    resetModelProviderForTests();

    const { executeOneLocalAgentTask } = await import("../src/ai/local-agent-execution.js");
    await expect(executeOneLocalAgentTask(devTaskId, "local")).rejects.toMatchObject({
      statusCode: 503,
    });

    process.env.LOCAL_AGENT_EXECUTION_MODE = "mock";
    process.env.MODEL_PROVIDER = "mock";
    process.env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY = "20";
    process.env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY = "20";
    delete process.env.LOCAL_LLM_BASE_URL;
    resetEnvCacheForTests();
    resetModelProviderForTests();
  });

  it("kill switch engeller", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: true, reason: "agent-exec-kill" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/agents/execute",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { limit: 1, taskIds: [devTaskId], agentIds: ["developer"] },
    });
    expect(res.statusCode).toBe(423);
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "agent-exec-unkill" },
    });
  });
});
