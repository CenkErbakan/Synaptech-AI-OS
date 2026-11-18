import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
// Bu suite deterministik/mock CEO chat bekler; kök .env local olsa bile mock zorlanır.
process.env.MODEL_PROVIDER = "mock";
process.env.SCHEDULER_AI_CEO_MODE = "off";
process.env.LOCAL_AI_PILOT = "false";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";

const testKillSwitchFile = path.join(os.tmpdir(), `synaptech-kill-switch-coord-${randomUUID()}.json`);
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

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN!;

describe("Faz 5B coordination", () => {
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
      payload: { enabled: false, reason: "coord-test-setup" },
    });
  });

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

  it("CEO→CTO→Developer→Tester→CTO→CEO zinciri mock simülasyonla kapanır", async () => {
    const idem = `coord-e2e-${randomUUID()}`;
    const start = await app.inject({
      method: "POST",
      url: "/api/coordination/chains/start",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        projectSlug: "synaptech-ai-os",
        title: "Faz5B E2E koordinasyon zinciri",
        description: "Mock deterministik test",
        idempotencyKey: idem,
      },
    });
    expect(start.statusCode).toBe(200);
    const body = start.json();
    expect(body.realAiExecution).toBe(false);
    expect(body.mode).toBe("deterministic_coordination");
    expect(body.steps).toHaveLength(6);
    expect(body.steps[0].workflowPhase).toBe("ready");
    expect(body.steps[1].workflowPhase).toBe("waiting_dependency");

    // Bağımlı adım erken tamamlanamaz
    const early = await app.inject({
      method: "POST",
      url: `/api/coordination/steps/${body.steps[1].id}/complete`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { result: "erken" },
    });
    expect(early.statusCode).toBe(200);
    expect(early.json().ok).toBe(false);

    const sim = await app.inject({
      method: "POST",
      url: `/api/coordination/chains/${body.chainId}/simulate`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().realAiExecution).toBe(false);
    expect(sim.json().completed.length).toBeGreaterThanOrEqual(6);

    const snap = await app.inject({
      method: "GET",
      url: `/api/coordination/chains/${body.chainId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(snap.statusCode).toBe(200);
    const snapshot = snap.json();
    expect(snapshot.realAiExecution).toBe(false);
    expect(snapshot.parent?.status).toBe("done");
    const byStep = Object.fromEntries(snapshot.steps.map((s: { chainStep: string; workflowPhase: string }) => [s.chainStep, s]));
    for (const step of ["ceo_plan", "cto_spec", "develop", "test", "cto_review", "ceo_close"]) {
      expect(byStep[step]?.workflowPhase).toBe("completed");
      expect(byStep[step]?.executionResult).toBeTruthy();
      expect(byStep[step]?.acceptanceCriteria).toBeTruthy();
    }
    expect(snapshot.messages.some((m: { kind: string }) => m.kind === "result")).toBe(true);
    expect(snapshot.messages.some((m: { kind: string }) => m.kind === "chain_closed")).toBe(true);
  });

  it("başarısız test rework zincirini tetikler", async () => {
    const idem = `coord-fail-${randomUUID()}`;
    const start = await app.inject({
      method: "POST",
      url: "/api/coordination/chains/start",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        projectSlug: "subify",
        title: "Faz5B failback testi",
        idempotencyKey: idem,
      },
    });
    expect(start.statusCode).toBe(200);
    const { chainId, steps } = start.json();

    // İlk 3 adımı tamamla (ceo, cto, develop)
    for (const step of steps.slice(0, 3)) {
      await app.inject({
        method: "POST",
        url: `/api/coordination/steps/${step.id}/start`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      const done = await app.inject({
        method: "POST",
        url: `/api/coordination/steps/${step.id}/complete`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { result: `${step.step} ok` },
      });
      expect(done.json().ok).toBe(true);
    }

    const testStep = steps.find((s: { step: string }) => s.step === "test");
    expect(testStep).toBeTruthy();
    await app.inject({
      method: "POST",
      url: `/api/coordination/steps/${testStep.id}/start`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const fail = await app.inject({
      method: "POST",
      url: `/api/coordination/steps/${testStep.id}/fail`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: "Mock: kabul kriteri karşılanmadı" },
    });
    expect(fail.statusCode).toBe(200);
    expect(fail.json().ok).toBe(true);
    expect(fail.json().reworkTaskId).toBeTruthy();

    const msgs = await app.inject({
      method: "GET",
      url: `/api/coordination/messages?chainId=${chainId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const kinds = msgs.json().messages.map((m: { kind: string }) => m.kind);
    expect(kinds).toContain("failure");
    expect(kinds).toContain("rework");

    const snap = await app.inject({
      method: "GET",
      url: `/api/coordination/chains/${chainId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const rework = snap.json().steps.find((s: { workflowPhase: string }) => s.workflowPhase === "rework");
    expect(rework?.assigneeId).toBe("developer");
  });

  it("CEO chat LLM gibi davranmaz; gerçek bağlam okur", async () => {
    const ctx = await app.inject({
      method: "GET",
      url: "/api/coordination/ceo-chat/context",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ctx.statusCode).toBe(200);
    expect(ctx.json().llmIntegrated).toBe(false);
    expect(ctx.json().chatMode).toBe("deterministic_context");

    const chat = await app.inject({
      method: "POST",
      url: "/api/coordination/ceo-chat/message",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { message: "hedefler neler?" },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().llmIntegrated).toBe(false);
    expect(String(chat.json().reply)).toMatch(/Deterministik|LLM/i);
  });
});
