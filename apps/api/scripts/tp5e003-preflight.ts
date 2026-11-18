/**
 * T-P5E-003 ön kontrol — gizli değer yazdırmaz.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { getKillSwitch } = await import("../src/engines/kill-switch.js");
  const { getEnv, resetEnvCacheForTests } = await import("../src/lib/env.js");
  const { countSchedulerAiCeoRunsToday, LOCAL_LLM_CALL_LEASE_KEY } = await import(
    "../src/ai/llm-call-guard.js"
  );
  resetEnvCacheForTests();
  const env = getEnv();
  const prisma = getPrisma();

  let ollamaOk = false;
  let ollamaModels: string[] = [];
  let ollamaError: string | null = null;
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    ollamaModels = (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    ollamaOk = ollamaModels.some((n) => n === "qwen2.5:14b" || n.startsWith("qwen2.5:14b"));
  } catch (e) {
    ollamaError = e instanceof Error ? e.message : "ollama_unreachable";
  }

  const kill = await getKillSwitch();
  const [total, active, archived, tp5eArchived, projects, llmLease, runsToday] = await Promise.all([
    prisma.task.count(),
    prisma.task.count({ where: { archivedAt: null } }),
    prisma.task.count({ where: { archivedAt: { not: null } } }),
    prisma.task.count({
      where: { archivedReason: { startsWith: "T-P5E-002" } },
    }),
    prisma.project.findMany({
      where: { slug: { in: ["synaptech-ai-os", "synaptech", "subify", "marivo"] } },
      select: { slug: true },
    }),
    prisma.workerLease.findUnique({ where: { lockKey: LOCAL_LLM_CALL_LEASE_KEY } }),
    countSchedulerAiCeoRunsToday(),
  ]);

  const now = new Date();
  const llmLeaseHeld = Boolean(llmLease) && llmLease!.expiresAt > now;
  // Mock test audit'leri kotayı doldurmuş olabilir; tek gerçek pilot için geçici max = used+1
  const pilotMaxNeeded = Math.min(24, Math.max(env.SCHEDULER_AI_CEO_MAX_PER_DAY, runsToday + 1));

  const report = {
    ok: true as boolean,
    blocks: [] as string[],
    warnings: [] as string[],
    archive: { total, active, archived, tp5eArchived },
    projects: projects.map((p) => p.slug).sort(),
    ollamaOk,
    ollamaModels,
    ollamaError,
    killEnabled: kill.enabled,
    modelProvider: env.MODEL_PROVIDER,
    schedulerMode: env.SCHEDULER_AI_CEO_MODE,
    localModel: env.LOCAL_LLM_MODEL,
    cloudLive: env.CLOUD_AGENT_LIVE_ENABLED,
    cloudMode: env.CURSOR_CLOUD_MODE,
    onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
    maxPerDay: env.SCHEDULER_AI_CEO_MAX_PER_DAY,
    schedulerAuditsToday: runsToday,
    pilotMaxNeeded,
    llmLeaseHeld,
    llmLeaseHolder: llmLease?.holderId ?? null,
    llmLeaseExpiresAt: llmLease?.expiresAt?.toISOString() ?? null,
  };

  if (archived < 231 || tp5eArchived !== 231) {
    report.blocks.push(`archive_incomplete_archived=${archived}_tp5e=${tp5eArchived}`);
  }
  if (!ollamaOk) report.blocks.push("ollama_model_missing");
  if (kill.enabled) report.blocks.push("kill_switch_on");
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    report.blocks.push("cloud_live_on");
  }
  if (env.CLOUD_ON_DEMAND_VERIFIED) report.blocks.push("on_demand_verified_true");
  if (projects.length !== 4) report.blocks.push(`projects=${projects.length}`);
  if (llmLeaseHeld) report.blocks.push("llm_lease_held");
  if (runsToday >= env.SCHEDULER_AI_CEO_MAX_PER_DAY) {
    report.warnings.push(
      `scheduler_audits_today=${runsToday} >= max=${env.SCHEDULER_AI_CEO_MAX_PER_DAY}; pilot için geçici MAX=${pilotMaxNeeded} (mock audit kotası)`,
    );
  }

  report.ok = report.blocks.length === 0;
  console.log(JSON.stringify(report, null, 2));
  await disconnectPrisma();
  if (!report.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
