/**
 * T-P5E-007 — canlı LLM yok; yalnızca ön kontrol.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { writeFileSync } from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT = path.resolve(process.cwd(), "../../reports/qa/faz-5e-tp5e007-preflight.json");

async function main() {
  const { resetEnvCacheForTests, getEnv } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  const env = getEnv();
  const { getKillSwitch } = await import("../src/engines/kill-switch.js");
  const kill = await getKillSwitch();
  const {
    assertSchedulerAiCeoDailyBudget,
    assertLocalAgentExecutionDailyBudget,
    assertPerAgentDailyBudget,
    countRealLocalModelCallsToday,
    countSchedulerAiCeoRunsToday,
  } = await import("../src/ai/llm-call-guard.js");
  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { getSchedulerRuntimeStatus } = await import("../src/engines/autonomy-scheduler.js");
  const { listProjectRepoBindings } = await import("../src/ai/repo/project-repo-registry.js");

  let ollama: { ok: boolean; models: string[]; message?: string } = {
    ok: false,
    models: [],
  };
  try {
    const base = env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434";
    const res = await fetch(`${base.replace(/\/$/, "")}/api/tags`);
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (json.models ?? []).map((m) => m.name);
    ollama = {
      ok: models.some((n) => n.includes("qwen2.5:14b")),
      models,
      message: models.some((n) => n.includes("qwen2.5:14b"))
        ? "qwen2.5:14b mevcut"
        : "qwen2.5:14b yok",
    };
  } catch (e) {
    ollama = {
      ok: false,
      models: [],
      message: e instanceof Error ? e.message : "ollama_unreachable",
    };
  }

  let docker: { ok: boolean; message: string } = { ok: false, message: "unchecked" };
  try {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      encoding: "utf8",
      windowsHide: true,
    });
    docker = {
      ok: r.status === 0 && Boolean(r.stdout?.trim()),
      message: r.status === 0 ? `engine ${r.stdout.trim()}` : (r.stderr || "docker_fail").slice(0, 200),
    };
  } catch (e) {
    docker = { ok: false, message: e instanceof Error ? e.message : "docker_error" };
  }

  const ceoBudget = await assertSchedulerAiCeoDailyBudget();
  // LOCAL_AGENT mode may be off — temporarily inspect with local semantics for planning
  const prevMode = process.env.LOCAL_AGENT_EXECUTION_MODE;
  process.env.LOCAL_AGENT_EXECUTION_MODE = "local";
  resetEnvCacheForTests();
  const agentBudgetLocalView = await assertLocalAgentExecutionDailyBudget();
  const realToday = await countRealLocalModelCallsToday();
  if (prevMode === undefined) delete process.env.LOCAL_AGENT_EXECUTION_MODE;
  else process.env.LOCAL_AGENT_EXECUTION_MODE = prevMode;
  resetEnvCacheForTests();

  const ceoToday = await countSchedulerAiCeoRunsToday();
  const agents = [
    "cto",
    "developer",
    "tester",
    "security",
    "growth-lead",
    "seo-specialist",
    "content-manager",
    "ads-manager",
  ] as const;
  const perAgent: Record<string, unknown> = {};
  for (const a of agents) perAgent[a] = await assertPerAgentDailyBudget(a);

  const prisma = getPrisma();
  const jobs = await prisma.scheduledJob.findMany({
    select: { jobKey: true, enabled: true, lastStatus: true, lastFinishedAt: true },
    orderBy: { jobKey: "asc" },
  });
  const bindings = await listProjectRepoBindings();
  const schedulerRuntime = getSchedulerRuntimeStatus();

  // Headroom for 1 CEO + 2 agents = 3 real calls
  const ceoHeadroom = ceoBudget.max - ceoBudget.used;
  const agentHeadroom = agentBudgetLocalView.max - agentBudgetLocalView.used;
  const neededCeo = 1;
  const neededAgents = 2;
  const quotaOk =
    ceoBudget.ok &&
    ceoHeadroom >= neededCeo &&
    agentBudgetLocalView.ok &&
    agentHeadroom >= neededAgents;

  const gates = {
    killOff: !kill.enabled,
    cloudLiveOff: !env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE !== "live",
    onDemandNotRequired: true,
    ollamaOk: ollama.ok,
    dockerOk: docker.ok,
    quotaOk,
    continuousAutomationAlwaysFalse: true,
    noteContinuous:
      "CONTROLLED_AUTONOMY_MODE=local ajan pass açar ama continuousAutomation alanı her zaman false kalır; süresiz otomasyon değildir.",
  };

  const payload = {
    taskId: "T-P5E-007-preflight",
    at: new Date().toISOString(),
    envSnapshot: {
      SCHEDULER_AI_CEO_MODE: env.SCHEDULER_AI_CEO_MODE,
      LOCAL_AGENT_EXECUTION_MODE: env.LOCAL_AGENT_EXECUTION_MODE,
      CONTROLLED_AUTONOMY_MODE: env.CONTROLLED_AUTONOMY_MODE,
      AGENT_REPO_TOOLS_MODE: env.AGENT_REPO_TOOLS_MODE,
      AGENT_SANDBOX_MODE: env.AGENT_SANDBOX_MODE,
      MODEL_PROVIDER: env.MODEL_PROVIDER,
      LOCAL_LLM_MODEL: env.LOCAL_LLM_MODEL,
      LOCAL_LLM_BASE_URL: env.LOCAL_LLM_BASE_URL ?? null,
      CLOUD_AGENT_LIVE_ENABLED: env.CLOUD_AGENT_LIVE_ENABLED,
      CURSOR_CLOUD_MODE: env.CURSOR_CLOUD_MODE,
      CLOUD_ON_DEMAND_VERIFIED: env.CLOUD_ON_DEMAND_VERIFIED,
      SCHEDULER_AI_CEO_MAX_PER_DAY: env.SCHEDULER_AI_CEO_MAX_PER_DAY,
      LOCAL_AGENT_EXECUTION_MAX_PER_DAY: env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY,
      LOCAL_AGENT_PER_AGENT_MAX_PER_DAY: env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY,
      LOCAL_AGENT_TICK_MAX: env.LOCAL_AGENT_TICK_MAX,
    },
    kill,
    ollama,
    docker,
    ceoBudget,
    agentBudgetLocalView,
    realToday,
    ceoToday,
    ceoHeadroom,
    agentHeadroom,
    needed: { ceo: neededCeo, agents: neededAgents },
    perAgent,
    jobs,
    bindings: bindings.map((b) => ({
      projectSlug: b.projectSlug,
      verified: b.verified,
      source: b.source,
    })),
    schedulerRuntime,
    gates,
    liveAllowed: Object.values(gates).every((v) => v === true || typeof v === "string"),
  };

  // liveAllowed: all boolean gates true
  const booleanGates = [
    gates.killOff,
    gates.cloudLiveOff,
    gates.ollamaOk,
    gates.dockerOk,
    gates.quotaOk,
  ];
  (payload as { liveAllowed: boolean }).liveAllowed = booleanGates.every(Boolean);

  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ out: OUT, liveAllowed: payload.liveAllowed, gates, ceoBudget, agentBudgetLocalView, realToday, ceoToday }, null, 2));
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
