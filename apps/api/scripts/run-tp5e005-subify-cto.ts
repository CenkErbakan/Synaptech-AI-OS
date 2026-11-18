/**
 * T-P5E-005 — Subify tek CTO salt-okunur gerçek repo inceleme pilotu.
 * T-P5E-004 görevlerine dokunmaz. Yazma/push/PR/Cloud yok.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT = path.resolve(process.cwd(), "../../reports/qa/faz-5e-tp5e005-live-result.json");
const SUBIFY_URL = "https://github.com/CenkErbakan/Subify";
const SUBIFY_ROOT = "C:\\Users\\cenke\\Desktop\\Projeler\\Subify";

async function main() {
  const { resetEnvCacheForTests } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  const { getEnv } = await import("../src/lib/env.js");
  const env = getEnv();

  if (env.AGENT_REPO_TOOLS_MODE !== "read_only") {
    throw new Error(`AGENT_REPO_TOOLS_MODE=${env.AGENT_REPO_TOOLS_MODE}`);
  }
  if (env.AGENT_SANDBOX_MODE !== "off") throw new Error(`AGENT_SANDBOX_MODE=${env.AGENT_SANDBOX_MODE}`);
  if (env.LOCAL_AGENT_EXECUTION_MODE !== "local") {
    throw new Error(`LOCAL_AGENT_EXECUTION_MODE=${env.LOCAL_AGENT_EXECUTION_MODE}`);
  }
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    throw new Error("Cloud live açık olmamalı");
  }
  if (env.SCHEDULER_AI_CEO_MODE !== "off") {
    throw new Error(`SCHEDULER_AI_CEO_MODE=${env.SCHEDULER_AI_CEO_MODE}`);
  }

  const { verifyLocalCheckoutRemote } = await import("../src/ai/repo/project-repo-registry.js");
  const checkout = verifyLocalCheckoutRemote(SUBIFY_ROOT, SUBIFY_URL);
  if (!checkout.ok) {
    throw new Error(`Subify checkout doğrulanamadı: ${checkout.reason} remote=${checkout.remote}`);
  }

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { writeAudit } = await import("../src/engines/audit.js");
  const prisma = getPrisma();

  await writeAudit({
    category: "autonomy",
    action: "approval.owner_tp5e005",
    actorKind: "owner",
    summary: "T-P5E-005 Owner onayı: Subify salt-okunur CTO repo inceleme (tek sefer).",
    metadata: {
      taskId: "T-P5E-005",
      type: "real_ai_provider_pilot",
      projectSlug: "subify",
      githubRepoUrl: SUBIFY_URL,
      localReadRoot: SUBIFY_ROOT,
      headSha: checkout.headSha,
      remote: checkout.remote,
      codeChangeAllowed: false,
      sandboxAllowed: false,
      cloudAllowed: false,
    },
  });

  const project = await prisma.project.update({
    where: { slug: "subify" },
    data: {
      githubRepoUrl: SUBIFY_URL,
      cloudAgentEnabled: false,
    },
  });

  // Diğer projelerin githubRepoUrl'sine dokunma
  const others = await prisma.project.findMany({
    where: { slug: { not: "subify" } },
    select: { slug: true, githubRepoUrl: true },
  });

  const origin = `owner-pilot:T-P5E-005-${new Date().toISOString().slice(0, 10)}`;
  let existing = await prisma.task.findFirst({
    where: {
      source: "real",
      assigneeId: "cto",
      origin: { startsWith: "owner-pilot:T-P5E-005" },
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  let ctoTaskId: string;
  if (existing) {
    ctoTaskId = existing.id;
    await prisma.task.update({
      where: { id: ctoTaskId },
      data: {
        status: "planned",
        dispatchState: "ready",
        workflowPhase: "ready",
        blockedReason: null,
        executionKind: "real_ai_pending",
      },
    });
  } else {
    const parentId = randomUUID();
    ctoTaskId = randomUUID();
    await prisma.task.create({
      data: {
        id: parentId,
        source: "real",
        title: "T-P5E-005 parent — Subify CTO salt-okunur inceleme",
        description: "Owner pilot parent; Cloud/yazma yok.",
        projectId: project.id,
        assigneeId: "ceo",
        priority: "high",
        status: "planned",
        dispatchState: "not_applicable",
        workflowPhase: "ready",
        origin,
        idempotencyKey: `tp5e005-parent-${parentId}`,
        acceptanceCriteria: "Parent — çocuk CTO görevi kanıt üretir.",
        executionKind: "real_ai_pending",
      },
    });
    await prisma.task.create({
      data: {
        id: ctoTaskId,
        source: "real",
        title: "Subify salt-okunur CTO teknik kod incelemesi (T-P5E-005)",
        description:
          "Subtitle.sln, frontend ve video-subtitle-service köklerini incele. Teknik borç yalnızca gerçek dosya kanıtıyla. MSSQL görev sayısı kanıt sayılmaz.",
        projectId: project.id,
        assigneeId: "cto",
        priority: "high",
        status: "planned",
        dispatchState: "ready",
        workflowPhase: "ready",
        origin,
        parentTaskId: parentId,
        idempotencyKey: `tp5e005-cto-${ctoTaskId}`,
        acceptanceCriteria:
          "En az 3 gerçek dosya yolundan (package.json/csproj/requirements/sln) bağımlılık ve test altyapısı özeti; her bulgu dosya yolu + HEAD SHA ile; teknik borç iddiası yalnızca dosya kanıtıyla; repo_read tek başına kabul sayılmaz.",
        executionKind: "real_ai_pending",
      },
    });
  }

  const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
  resetModelProviderForTests();

  const { runLocalAgentExecutionPass } = await import("../src/ai/local-agent-execution.js");
  const started = Date.now();
  const result = await runLocalAgentExecutionPass({
    limit: 1,
    taskIds: [ctoTaskId],
    agentIds: ["cto"],
  });

  const task = await prisma.task.findUnique({
    where: { id: ctoTaskId },
    include: { project: true },
  });
  const messages = await prisma.agentMessage.findMany({
    where: { taskId: ctoTaskId, kind: "result" },
    orderBy: { createdAt: "asc" },
  });
  const audits = await prisma.auditLog.findMany({
    where: {
      OR: [
        { action: "approval.owner_tp5e005" },
        { action: "ai.local_agent_execution", targetId: ctoTaskId },
      ],
    },
    orderBy: { at: "asc" },
    take: 10,
  });

  const tp5e004Touch = await prisma.task.findMany({
    where: {
      id: {
        in: [
          "e8e0cfc6-e98b-4b70-966d-60b5c33398eb",
          "e07d1fd4-20f4-44e2-86cf-b75415c0f89d",
        ],
      },
    },
    select: { id: true, status: true, executionKind: true, updatedAt: true },
  });

  const envelope = {
    taskId: "T-P5E-005",
    wallClockMs: Date.now() - started,
    checkout,
    project: {
      slug: project.slug,
      githubRepoUrl: project.githubRepoUrl,
      cloudAgentEnabled: project.cloudAgentEnabled,
    },
    otherProjectsUntouched: others,
    result,
    task: task
      ? {
          id: task.id,
          title: task.title,
          status: task.status,
          model: task.model,
          executionKind: task.executionKind,
          blockedReason: task.blockedReason,
          executionResult: task.executionResult,
          acceptanceCriteria: task.acceptanceCriteria,
        }
      : null,
    messages: messages.map((m) => ({
      id: m.id,
      from: m.fromAgentId,
      to: m.toAgentId,
      summary: m.summary,
      payloadJson: m.payloadJson,
    })),
    audits: audits.map((a) => ({
      action: a.action,
      summary: a.summary,
      at: a.at,
      metadata: a.metadata,
    })),
    tp5e004TasksUnchangedCheck: tp5e004Touch,
  };

  writeFileSync(OUT, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const processed = result.processed[0];
  const ok =
    Boolean(processed?.realAiExecution) &&
    processed?.assigneeId === "cto" &&
    processed?.codeChangeApplied !== true &&
    result.cloudStarted === false;

  console.log(
    JSON.stringify(
      {
        ok,
        ctoTaskId,
        headSha: checkout.headSha,
        realAiExecution: processed?.realAiExecution ?? false,
        acceptanceMet: processed?.acceptanceMet ?? null,
        codeChangeApplied: processed?.codeChangeApplied ?? null,
        status: processed?.status,
        modelId: processed?.modelId,
        durationMs: processed?.durationMs,
        out: OUT,
      },
      null,
      2,
    ),
  );

  await disconnectPrisma();
  if (!ok) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
