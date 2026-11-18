/**
 * Salt okunur temiz-operasyon ön kontrol. Silme yok. LLM yok.
 */
import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { getKillSwitch } from "../src/engines/kill-switch.js";
import { readOwnerGrants } from "../src/engines/owner-grants.js";
import { currentEpochStartedAt, readOperationEpoch } from "../src/engines/operation-epoch.js";
import { listProjectRepoBindings } from "../src/ai/repo/project-repo-registry.js";
import { getEnv } from "../src/lib/env.js";
import { getSchedulerRuntimeStatus } from "../src/engines/autonomy-scheduler.js";

async function main() {
  const p = getPrisma();
  const epoch = await readOperationEpoch();
  const epochAt = await currentEpochStartedAt();
  const [tasks, approvals, messages, agents, projects, goals, seo, drafts, ads, scans] = await Promise.all([
    p.task.count(),
    p.approval.count(),
    p.agentMessage.count(),
    p.agent.findMany({ select: { id: true, enabled: true } }),
    p.project.findMany({ select: { slug: true, githubRepoUrl: true, cloudAgentEnabled: true } }),
    p.companyGoal.findMany({ select: { goalKey: true, projectSlug: true, status: true, dataSource: true } }),
    p.seoFinding.findMany({ select: { id: true, title: true, projectSlug: true, createdAt: true, findingKind: true } }),
    p.contentDraftRecord.findMany({ select: { id: true, title: true, status: true, createdAt: true } }),
    p.adProposal.findMany({ select: { id: true, campaignName: true, liveLaunch: true, createdAt: true } }),
    p.growthScanRun.findMany({
      select: { id: true, kind: true, status: true, startedAt: true, summary: true },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
  ]);
  const bindings = await listProjectRepoBindings();
  const kill = await getKillSwitch();
  const grants = await readOwnerGrants();
  const env = getEnv();
  const runtime = getSchedulerRuntimeStatus();
  const jobs = await p.scheduledJob.findMany({ select: { jobKey: true, enabled: true, handler: true } });

  let ollama: { ok: boolean; model?: string; error?: string } = { ok: false };
  try {
    const base = env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434";
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { models?: Array<{ name?: string }> };
    const names = (j.models ?? []).map((m) => m.name ?? "");
    ollama = { ok: names.some((n) => n.includes("qwen2.5:14b")), model: names.find((n) => n.includes("qwen2.5:14b")) };
    if (!ollama.ok) ollama = { ok: false, error: `tags=${names.slice(0, 8).join(",")}` };
  } catch (e) {
    ollama = { ok: false, error: e instanceof Error ? e.message : "fetch_failed" };
  }

  const classify = (createdAt: Date) =>
    epochAt && createdAt.getTime() < epochAt.getTime() ? "legacy_pilot" : "current_epoch";

  console.log(
    JSON.stringify(
      {
        epoch,
        queue: { task: tasks, approval: approvals, message: messages },
        agents: agents.length,
        projects,
        goals,
        growth: {
          seo: seo.map((r) => ({ ...r, cls: classify(r.createdAt), createdAt: r.createdAt.toISOString() })),
          drafts: drafts.map((r) => ({ ...r, cls: classify(r.createdAt), createdAt: r.createdAt.toISOString() })),
          ads: ads.map((r) => ({ ...r, cls: classify(r.createdAt), createdAt: r.createdAt.toISOString() })),
          scanSample: scans.map((r) => ({
            ...r,
            cls: classify(r.startedAt),
            startedAt: r.startedAt.toISOString(),
          })),
          scanTotal: await p.growthScanRun.count(),
        },
        bindings: bindings.map((b) => ({
          projectSlug: b.projectSlug,
          verified: b.verified,
          source: b.source,
          blockedReason: b.blockedReason,
          githubRepoUrl: b.githubRepoUrl,
        })),
        kill: {
          enabled: kill.enabled,
          conflict: kill.conflict,
          source: kill.source,
          dbEnabled: kill.dbEnabled,
          fileEnabled: kill.fileEnabled,
        },
        grants,
        envModes: {
          SCHEDULER_AI_CEO_MODE: env.SCHEDULER_AI_CEO_MODE,
          LOCAL_AGENT_EXECUTION_MODE: env.LOCAL_AGENT_EXECUTION_MODE,
          CONTROLLED_AUTONOMY_MODE: env.CONTROLLED_AUTONOMY_MODE,
          MODEL_PROVIDER: env.MODEL_PROVIDER,
          CLOUD_AGENT_LIVE_ENABLED: env.CLOUD_AGENT_LIVE_ENABLED,
          CURSOR_CLOUD_MODE: env.CURSOR_CLOUD_MODE,
        },
        jobs,
        runtime: { timerActive: runtime.timerActive, ticking: runtime.ticking, workerId: runtime.workerId },
        ollama,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
