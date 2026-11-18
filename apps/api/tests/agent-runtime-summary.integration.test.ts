import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(
  os.tmpdir(),
  `synaptech-kill-switch-runtime-${randomUUID()}.json`,
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
process.env.SCHEDULER_AI_CEO_MODE = "off";
process.env.LOCAL_AGENT_EXECUTION_MODE = "off";
process.env.AGENT_REPO_TOOLS_MODE = "off";
process.env.AGENT_SANDBOX_MODE = "off";
process.env.MODEL_PROVIDER = "mock";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;
const hasDb = Boolean(process.env.DATABASE_URL && ownerToken);

describe.runIf(hasDb)("Agent runtime-summary (MSSQL)", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

  beforeAll(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("per-agent özet döner; arşivli sayılmaz; kanallar ayrılır", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agents/runtime-summary",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    if (res.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error("runtime-summary body:", res.body);
    }
    expect(res.statusCode).toBe(200);
    const body = res.json() as Awaited<
      ReturnType<typeof import("../src/engines/agent-runtime-summary.js").buildAgentRuntimeSummary>
    >;
    expect(body.source).toBe("api");
    expect(body.generatedAt).toBeTruthy();
    expect(body.agents).toHaveLength(9);
    expect(body.modes.schedulerAiCeoMode).toBe("off");
    expect(body.modes.cloudLiveEnabled).toBe(false);
    expect(body.cursor.liveEnabled).toBe(false);

    const cto = body.agents.find((a) => a.agentId === "cto");
    const developer = body.agents.find((a) => a.agentId === "developer");
    const tester = body.agents.find((a) => a.agentId === "tester");
    const ceo = body.agents.find((a) => a.agentId === "ceo");
    expect(cto).toBeTruthy();
    expect(developer).toBeTruthy();
    expect(tester).toBeTruthy();
    expect(ceo).toBeTruthy();

    // Subify verified (T-P5E-005 MSSQL githubRepoUrl)
    const subify = body.github.projects.find((p) => p.slug === "subify");
    expect(subify?.verified).toBe(true);
    expect(subify?.githubRepoUrl).toContain("Subify");

    const marivo = body.github.projects.find((p) => p.slug === "marivo");
    expect(marivo?.verified).toBe(false);
    expect(marivo?.githubRepoUrl).toBeNull();

    // Modlar off → kimse "çalışıyor" olmamalı (stale in_progress artıkları)
    for (const a of body.agents) {
      expect(a.currentlyWorking).toBe(false);
    }

    // CTO: T-P5E-005 done + 8 repo_read (gerçek LOCAL_LLM, mock test ezmez)
    expect(cto?.channel).toBe("LOCAL_LLM");
    expect(cto?.lastTask?.title).toMatch(/T-P5E-005/);
    expect(cto?.lastTask?.status).toBe("done");
    expect(cto?.lastTask?.repoReadCount).toBeGreaterThanOrEqual(8);
    expect(cto?.lastRealModel).toMatch(/qwen2\.5:14b/);

    // Developer: gerçek LLM; T-P5E-006-retry sandbox_diff varsa codeChangeApplied=true olabilir
    expect(developer?.channel).toBe("LOCAL_LLM");
    expect(developer?.lastTask?.realAiExecution).toBe(true);
    expect(developer?.lastRealModel).toMatch(/qwen2\.5:14b/);
    if (developer?.lastTask?.codeChangeApplied === false) {
      expect(developer?.notes.some((n) => n.includes("kod değişikliği uygulanmadı"))).toBe(true);
    } else {
      expect(developer?.lastTask?.codeChangeApplied).toBe(true);
    }

    // Tester: T-P5E-006-retry sonrası gerçek LOCAL_LLM olabilir; yoksa uyarı notu
    if (tester?.lastTask?.realAiExecution) {
      expect(tester.channel).toBe("LOCAL_LLM");
      expect(tester.lastRealModel).toMatch(/qwen2\.5:14b/);
    } else {
      expect(tester?.lastTask).toBeNull();
      expect(tester?.channel).toBe("NONE");
      expect(tester?.notes.some((n) => n.includes("Canlı gerçek Tester"))).toBe(true);
    }

    // CEO: scheduler audit kaydı
    expect(body.ceoScheduler.recentCount).toBeGreaterThan(0);
    expect(ceo?.notes.some((n) => n.includes("CEO AI audit"))).toBe(true);
  });
});
