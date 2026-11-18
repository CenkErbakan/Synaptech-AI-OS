import { beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "sqlserver://localhost:14333;database=SynaptechAiOs;user=sa;password=test;encrypt=false;trustServerCertificate=true";
process.env.SYNAPTECH_OWNER_TOKEN = process.env.SYNAPTECH_OWNER_TOKEN || "dev-owner-change-me-32chars-minimum!!";
process.env.SYNAPTECH_SYSTEM_TOKEN = process.env.SYNAPTECH_SYSTEM_TOKEN || "dev-system-change-me-32chars-minimum!";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";
process.env.CLOUD_AGENT_ALLOWED_REPOS = "https://github.com/example/isolated-test-repo";
process.env.CLOUD_AGENT_STARTING_REF = "master";
process.env.CLOUD_ON_DEMAND_VERIFIED = "false";

const { resetEnvCacheForTests } = await import("../src/lib/env.js");
resetEnvCacheForTests();

const { CursorCloudAdapter, resetCursorCloudAdapterForTests } = await import("../src/cursor/adapter.js");
const { MockCursorCloudClient } = await import("../src/cursor/mock-client.js");
const { redactSecrets, buildSafeCloudPrompt } = await import("../src/cursor/sanitize.js");
const { mapCursorRunToDomain } = await import("@synaptech/shared");
const { LiveCursorCloudClient } = await import("../src/cursor/live-client.js");

describe("CursorCloudAdapter (mock)", () => {
  let adapter: InstanceType<typeof CursorCloudAdapter>;
  let mock: InstanceType<typeof MockCursorCloudClient>;

  beforeEach(() => {
    resetEnvCacheForTests();
    resetCursorCloudAdapterForTests();
    process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
    process.env.CURSOR_CLOUD_MODE = "mock";
    process.env.CLOUD_AGENT_ALLOWED_REPOS = "https://github.com/example/isolated-test-repo";
    process.env.CLOUD_AGENT_STARTING_REF = "master";
    mock = new MockCursorCloudClient();
    adapter = new CursorCloudAdapter(mock);
  });

  it("bağlantı durumu live kapalıyı gösterir", () => {
    const status = adapter.getStatus();
    expect(status.liveEnabled).toBe(false);
    expect(status.mode).toBe("mock");
    expect(status.maxConcurrentRuns).toBe(1);
    expect(status.autoRetry).toBe(false);
    expect(status.remainingUsageKnown).toBe(false);
  });

  it("onaysız dispatch Cloud create yapmaz", async () => {
    const result = await adapter.dispatch({
      taskId: "11111111-1111-1111-1111-111111111111",
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "Test",
      description: "Desc",
      priority: "medium",
      repositoryUrl: "https://github.com/example/isolated-test-repo",
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("awaiting_execution_approval");
  });

  it("izinli olmayan repository'yi reddeder", async () => {
    const result = await adapter.dispatch({
      taskId: "11111111-1111-1111-1111-111111111111",
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "Test",
      description: "Desc",
      priority: "medium",
      approvalId: "22222222-2222-2222-2222-222222222222",
      repositoryUrl: "https://github.com/acme/synaptech-prod",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/izinli listede değil/i);
  });

  it("mock ile agent/run oluşturur ve iptali doğrular", async () => {
    const taskId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const created = await adapter.dispatch({
      taskId,
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "Mock run",
      description: "Açıklama",
      priority: "low",
      approvalId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      repositoryUrl: "https://github.com/example/isolated-test-repo",
      clientAgentId: `bc-${taskId}`,
    });
    expect(created.ok).toBe(true);
    expect(created.state).toBe("dispatched");
    expect(created.mode).toBe("mock");
    expect(created.cursorAgentId).toBe(`bc-${taskId}`);
    expect(created.cursorRunId).toMatch(/^run-/);

    const storedAgent = await mock.getAgent(created.cursorAgentId!);
    expect(storedAgent.autoCreatePR).toBe(false);
    expect(storedAgent.workOnCurrentBranch).toBe(false);
    expect(storedAgent.repos?.[0]?.startingRef).toBe("master");

    mock.advanceRun(created.cursorAgentId!, "RUNNING");
    const synced = await adapter.getRun(created.cursorAgentId!, created.cursorRunId!);
    expect(synced.run.status).toBe("RUNNING");
    expect(synced.domain.dispatchState).toBe("dispatched");

    const cancel = await adapter.cancelRun(created.cursorAgentId!, created.cursorRunId!);
    expect(cancel.verified).toBe(true);
  });

  it("geçersiz API anahtarını güvenli işler", async () => {
    mock.setAuthInvalid(true);
    const result = await adapter.dispatch({
      taskId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "Auth",
      description: "x",
      priority: "low",
      approvalId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      repositoryUrl: "https://github.com/example/isolated-test-repo",
    });
    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/key_/i);
  });

  it("rate limit'te otomatik retry yapmaz", async () => {
    mock.setScenario("rate_limit");
    const result = await adapter.dispatch({
      taskId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "RL",
      description: "x",
      priority: "low",
      approvalId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      repositoryUrl: "https://github.com/example/isolated-test-repo",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Rate limit/i);
    expect(result.message).toMatch(/retry yok/i);
  });

  it("timeout'ta reconciliation_required işaretler", async () => {
    mock.setScenario("timeout");
    const result = await adapter.dispatch({
      taskId: "99999999-9999-9999-9999-999999999999",
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "TO",
      description: "x",
      priority: "low",
      approvalId: "88888888-8888-8888-8888-888888888888",
      repositoryUrl: "https://github.com/example/isolated-test-repo",
      clientAgentId: "bc-99999999-9999-9999-9999-999999999999",
    });
    expect(result.state).toBe("reconciliation_required");
  });

  it("çift create aynı agentId ile conflict → reconciliation", async () => {
    const taskId = "12121212-1212-1212-1212-121212121212";
    const req = {
      taskId,
      agentId: "ceo",
      projectSlug: "synaptech",
      title: "Dup",
      description: "x",
      priority: "low" as const,
      approvalId: "34343434-3434-3434-3434-343434343434",
      repositoryUrl: "https://github.com/example/isolated-test-repo",
      clientAgentId: `bc-${taskId}`,
    };
    const first = await adapter.dispatch(req);
    expect(first.ok).toBe(true);
    const second = await adapter.dispatch(req);
    expect(second.ok).toBe(false);
    expect(second.state).toBe("reconciliation_required");
  });

  it("live client create'i live bayrak kapalıyken reddeder", async () => {
    const live = new LiveCursorCloudClient({
      apiKey: "test-key-not-real",
      liveCreateEnabled: false,
    });
    await expect(
      live.createAgent({
        promptText: "hi",
        repositoryUrl: "https://github.com/example/isolated-test-repo",
      }),
    ).rejects.toMatchObject({ code: "live_disabled" });
  });
});

describe("sanitize + status mapping", () => {
  it("API anahtarını redakte eder", () => {
    expect(redactSecrets("Authorization: Bearer secret123456")).toMatch(/REDACTED/);
    expect(redactSecrets("CURSOR_API_KEY=abc")).toMatch(/REDACTED/i);
  });

  it("prompt'a anahtar eklemez", () => {
    const prompt = buildSafeCloudPrompt({
      taskId: "t1",
      title: "Başlık",
      description: "Açıklama",
      projectSlug: "synaptech",
      agentRole: "ceo",
    });
    expect(prompt).not.toMatch(/API_KEY|Bearer|sk-/i);
    expect(prompt).toContain("SynapTech");
  });

  it("FINISHED'i otomatik done saymaz", () => {
    const mapped = mapCursorRunToDomain("FINISHED");
    expect(mapped.taskStatus).toBe("in_review");
    expect(mapped.taskStatus).not.toBe("done");
  });

  it("bilinmeyen durumu başarılı saymaz (domain helper)", () => {
    const mapped = mapCursorRunToDomain("ERROR");
    expect(mapped.taskStatus).toBe("failed");
  });
});
