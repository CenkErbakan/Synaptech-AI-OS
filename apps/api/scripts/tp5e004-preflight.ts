/**
 * T-P5E-004 ön kontrol — gizli değer yazdırmaz.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { getKillSwitch } = await import("../src/engines/kill-switch.js");
  const { getEnv, resetEnvCacheForTests } = await import("../src/lib/env.js");
  const { LOCAL_LLM_CALL_LEASE_KEY } = await import("../src/ai/llm-call-guard.js");
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
  const llmLease = await prisma.workerLease.findUnique({ where: { lockKey: LOCAL_LLM_CALL_LEASE_KEY } });
  const now = new Date();
  const llmLeaseHeld = Boolean(llmLease) && llmLease!.expiresAt > now;

  const candidates = await prisma.task.findMany({
    where: {
      source: "real",
      archivedAt: null,
      parentTaskId: { not: null },
      assigneeId: { in: ["cto", "developer"] },
      status: { in: ["planned", "backlog"] },
      origin: { startsWith: "scheduler-ai-ceo:T-P5E-003" },
    },
    include: { project: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: 10,
  });

  const running = await prisma.task.count({
    where: {
      source: "real",
      archivedAt: null,
      dispatchState: "running",
      OR: [{ executionKind: "local_llm" }, { executionKind: "real_ai_pending" }],
    },
  });

  const blocks: string[] = [];
  if (!ollamaOk) blocks.push("ollama_model_missing");
  if (kill.enabled) blocks.push("kill_switch_on");
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") blocks.push("cloud_live_on");
  if (env.CLOUD_ON_DEMAND_VERIFIED) blocks.push("on_demand_verified_true");
  if (env.SCHEDULER_AI_CEO_MODE !== "off") blocks.push(`scheduler_ai_ceo_mode=${env.SCHEDULER_AI_CEO_MODE}`);
  if (llmLeaseHeld) blocks.push("llm_lease_held");
  if (running > 0) blocks.push(`running_llm_tasks=${running}`);
  if (candidates.length < 1) blocks.push("no_tp5e003_cto_developer_candidates");

  const selected = [...candidates]
    .sort((a, b) => {
      const rank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
      const role = (id: string) => (id === "cto" ? 0 : 1);
      return role(a.assigneeId) - role(b.assigneeId) || rank(a.priority) - rank(b.priority);
    })
    .slice(0, 2);

  // Tercihen 1 cto + 1 developer
  const cto = candidates.find((c) => c.assigneeId === "cto");
  const dev = candidates.find((c) => c.assigneeId === "developer");
  const pick = [cto, dev].filter(Boolean).slice(0, 2) as typeof candidates;
  const finalPick = pick.length === 2 ? pick : selected;

  if (finalPick.length < 1) blocks.push("insufficient_selected_tasks");
  for (const t of finalPick) {
    if (!t.acceptanceCriteria?.trim()) blocks.push(`missing_acceptance:${t.id}`);
    if (t.archivedAt) blocks.push(`archived:${t.id}`);
    if (!["synaptech-ai-os", "synaptech", "subify", "marivo"].includes(t.project.slug)) {
      blocks.push(`bad_project:${t.id}`);
    }
  }

  const report = {
    ok: blocks.length === 0,
    blocks,
    ollamaOk,
    ollamaModels,
    ollamaError,
    killEnabled: kill.enabled,
    modelProvider: env.MODEL_PROVIDER,
    schedulerAiCeoMode: env.SCHEDULER_AI_CEO_MODE,
    localAgentMode: env.LOCAL_AGENT_EXECUTION_MODE,
    cloudLive: env.CLOUD_AGENT_LIVE_ENABLED,
    cloudMode: env.CURSOR_CLOUD_MODE,
    onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
    llmLeaseHeld,
    runningLlmTasks: running,
    candidateCount: candidates.length,
    selected: finalPick.map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId,
      status: t.status,
      origin: t.origin,
      projectSlug: t.project.slug,
      acceptanceCriteria: t.acceptanceCriteria,
      executionKind: t.executionKind,
      priority: t.priority,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  await disconnectPrisma();
  if (!report.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
