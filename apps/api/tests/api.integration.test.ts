import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

// Korumalı config/kill-switch.json dokunulmaz — test aynası temp dosya + skip bayrağı
const testKillSwitchFile = path.join(os.tmpdir(), `synaptech-kill-switch-${randomUUID()}.json`);
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
// Gate contentVersion allow-list[0] kullanır; execute URL ile birebir olmalı.
process.env.CLOUD_AGENT_ALLOWED_REPOS = "https://github.com/example/isolated-test-repo";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;
const systemToken = process.env.SYNAPTECH_SYSTEM_TOKEN!;

describe("SynapTech API integration", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

  beforeAll(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();

    // Önceki test kalıntısı: DB kill switch kapalı olsun (dosyaya yazılmaz)
    await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "integration-test-setup" },
    });
  });

  afterAll(async () => {
    try {
      await app.inject({
        method: "PATCH",
        url: "/api/system/kill-switch",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { enabled: false, reason: "integration-test-teardown" },
      });
    } catch {
      /* ignore */
    }
    await app.close();
    const { disconnectPrisma } = await import("../src/db/prisma.js");
    await disconnectPrisma();
    try {
      fs.unlinkSync(testKillSwitchFile);
    } catch {
      /* ignore */
    }
  });

  it("sağlık kontrolü auth gerektirmez", async () => {
    const res = await app.inject({ method: "GET", url: "/api/system/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.database.ok).toBe(true);
  });

  it("yetkisiz istekleri reddeder", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(401);
  });

  it("system token ile Owner-only kill switch değiştirilemez", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${systemToken}` },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("CEO görevi oluşturur, idempotenttir ve yenilemede kalır", async () => {
    const key = `ceo-${randomUUID()}`;
    const payload = {
      title: "Faz3 E2E CEO görevi",
      description: "Entegrasyon testi",
      projectSlug: "synaptech",
      priority: "high",
      notes: "Cursor bekleniyor",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/tasks/ceo",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": key,
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const task1 = first.json().task;
    expect(task1.assignee).toBe("ceo");
    expect(task1.status).toBe("planned");
    expect(task1.dispatchState).toBe("awaiting_execution_approval");
    expect(task1.source).toBe("api");

    const second = await app.inject({
      method: "POST",
      url: "/api/tasks/ceo",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": key,
      },
      payload,
    });
    expect(second.json().task.id).toBe(task1.id);

    const listed = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listed.json().tasks.some((t: { id: string }) => t.id === task1.id)).toBe(true);
  });

  it("kill switch açıkken yeni CEO görevini engeller (korumalı dosyaya yazmaz)", async () => {
    const protectedPath = path.resolve(process.cwd(), "../../config/kill-switch.json");
    const before = fs.readFileSync(protectedPath, "utf8");

    const enable = await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: true, reason: "integration-test" },
    });
    expect(enable.statusCode).toBe(200);

    const afterEnable = fs.readFileSync(protectedPath, "utf8");
    expect(afterEnable).toBe(before);

    const blocked = await app.inject({
      method: "POST",
      url: "/api/tasks/ceo",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `ks-${randomUUID()}`,
      },
      payload: {
        title: "Kill switch engeli",
        projectSlug: "synaptech",
        description: "olmamalı",
      },
    });
    expect(blocked.statusCode).toBe(423);

    const disable = await app.inject({
      method: "PATCH",
      url: "/api/system/kill-switch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: false, reason: "integration-test-reset" },
    });
    expect(disable.statusCode).toBe(200);

    const afterDisable = fs.readFileSync(protectedPath, "utf8");
    expect(afterDisable).toBe(before);
  });

  it("onay sürüm değişince geçersizleşir", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/approvals",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        type: "blog_publish",
        requestedBy: "content-manager",
        projectSlug: "synaptech",
        title: "Blog taslağı",
        description: "TR taslak",
        changeSummary: "1 dosya",
        risk: "medium",
        subjectKind: "content_sha256",
        subjectRef: "content/blog/drafts/tr/x.md",
        subjectVersion: "sha:aaa",
      },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().approval.id;

    const approved = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/decide`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { decision: "approved" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().execution.executed).toBe(false);

    const bumped = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/bump-version`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { version: "sha:bbb" },
    });
    expect(bumped.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: "/api/approvals",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const row = list.json().approvals.find((a: { id: string }) => a.id === id);
    expect(row.effectiveStatus).toBe("invalidated");
  });

  it("ajanlar sahte working göstermez", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const working = res.json().agents.filter((a: { status: string }) => a.status === "working");
    // Gerçek görevler working gösterebilir; dayanak tasks + currentTaskId olmalı (uydurma yok).
    for (const agent of working) {
      expect(agent.statusBasis).toBe("tasks");
      expect(agent.currentTaskId).toBeTruthy();
    }
  });

  it("cloud status anahtar sızdırmaz ve live kapalıdır", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cloud/status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cloud.liveEnabled).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/CURSOR_API_KEY|sk-|key_[A-Za-z0-9]{12,}/);
    expect(body.cloud).not.toHaveProperty("apiKey");
  });

  it("CEO → onay → mock execute → sync akışı", async () => {
    const ceo = await app.inject({
      method: "POST",
      url: "/api/tasks/ceo",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `cloud-${randomUUID()}`,
      },
      payload: {
        title: "Faz4A mock pilot görevi",
        description: "Mock Cloud akış testi",
        projectSlug: "synaptech",
        priority: "medium",
      },
    });
    expect(ceo.statusCode).toBe(200);
    const task = ceo.json().task;
    expect(task.dispatchState).toBe("awaiting_execution_approval");
    expect(task.approvalId).toBeTruthy();

    const decide = await app.inject({
      method: "POST",
      url: `/api/approvals/${task.approvalId}/decide`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { decision: "approved" },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().execution.executed).toBe(false);

    const exec = await app.inject({
      method: "POST",
      url: "/api/cloud/runs/execute",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        taskId: task.id,
        approvalId: task.approvalId,
        repositoryUrl: "https://github.com/example/isolated-test-repo",
      },
    });
    expect(exec.statusCode).toBe(200);
    const execBody = exec.json();
    expect(execBody.ok).toBe(true);
    expect(execBody.mode).toBe("mock");
    expect(execBody.cursorAgentId).toBeTruthy();

    const sync = await app.inject({
      method: "POST",
      url: `/api/cloud/tasks/${task.id}/sync`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(sync.statusCode).toBe(200);

    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { description: "Değişen içerik — sürüm kırılır" },
    });

    const exec2 = await app.inject({
      method: "POST",
      url: "/api/cloud/runs/execute",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        taskId: task.id,
        approvalId: task.approvalId,
        repositoryUrl: "https://github.com/example/isolated-test-repo",
      },
    });
    // Sürüm uyuşmazlığı veya aktif run çakışması
    expect([200, 400, 409]).toContain(exec2.statusCode);
    if (exec2.statusCode === 400) {
      expect(String(exec2.json()?.error?.message ?? "")).toMatch(/sürüm|onay/i);
    }
  });

  it("Faz 5A: scheduler tick → fırsat → CEO görev → AgentMessage (deterministik)", async () => {
    const tick = await app.inject({
      method: "POST",
      url: "/api/autonomy/scheduler/tick",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(tick.statusCode).toBe(200);
    const tickBody = tick.json();
    expect(Array.isArray(tickBody.ran)).toBe(true);

    const status = await app.inject({
      method: "GET",
      url: "/api/autonomy/status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(status.statusCode).toBe(200);
    const st = status.json();
    expect(st.planner).toBe("deterministic");
    expect(st.llmIntegrated).toBe(false);
    expect(st.cloudAutoDispatch).toBe(false);
    expect(st.counts.goals).toBeGreaterThanOrEqual(4);
    expect(st.counts.opportunities).toBeGreaterThanOrEqual(1);

    // Idempotent ikinci tick (aynı dakika kovası) atlanabilir; CEO cycle manuel tetiklenebilir
    const cycle = await app.inject({
      method: "POST",
      url: "/api/autonomy/ceo/cycle",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(cycle.statusCode).toBe(200);
    const c = cycle.json();
    expect(c.planner).toBe("deterministic");
    expect(c.parentTaskId || c.skippedReason).toBeTruthy();

    if (c.parentTaskId) {
      expect(c.subtaskId).toBeTruthy();
      expect(c.messageId).toBeTruthy();
      const tasks = await app.inject({
        method: "GET",
        url: "/api/autonomy/tasks",
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(tasks.statusCode).toBe(200);
      const rows = tasks.json().tasks as Array<{ id: string; parentTaskId: string | null }>;
      expect(rows.some((t) => t.id === c.parentTaskId)).toBe(true);
      expect(rows.some((t) => t.id === c.subtaskId && t.parentTaskId === c.parentTaskId)).toBe(true);

      const messages = await app.inject({
        method: "GET",
        url: "/api/autonomy/messages",
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(messages.statusCode).toBe(200);
      expect(messages.json().messages.some((m: { id: string }) => m.id === c.messageId)).toBe(true);
    }

    const audit = await app.inject({
      method: "GET",
      url: "/api/audit?limit=50",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(audit.statusCode).toBe(200);
    const actions = (audit.json().events ?? audit.json().items ?? []).map(
      (e: { action?: string }) => e.action,
    );
    expect(
      actions.some(
        (a: string) =>
          a === "scheduler.tick" || a === "ceo.cycle_completed" || a === "opportunity.scan_completed",
      ),
    ).toBe(true);
  });
});
