/**
 * T-P5E-004 — CTO + Developer tek gerçek yerel LLM pilotu (max 2).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT = path.resolve(process.cwd(), "../../reports/qa/faz-5e-tp5e004-live-result.json");
const CTO_ID = "e8e0cfc6-e98b-4b70-966d-60b5c33398eb";
const DEV_ID = "e07d1fd4-20f4-44e2-86cf-b75415c0f89d";

async function main() {
  const { resetEnvCacheForTests } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  const { getEnv } = await import("../src/lib/env.js");
  const env = getEnv();
  if (env.LOCAL_AGENT_EXECUTION_MODE !== "local") {
    throw new Error(`LOCAL_AGENT_EXECUTION_MODE=${env.LOCAL_AGENT_EXECUTION_MODE}`);
  }
  if (env.MODEL_PROVIDER !== "local") throw new Error(`MODEL_PROVIDER=${env.MODEL_PROVIDER}`);
  if (env.SCHEDULER_AI_CEO_MODE !== "off") {
    throw new Error(`SCHEDULER_AI_CEO_MODE=${env.SCHEDULER_AI_CEO_MODE}`);
  }
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    throw new Error("Cloud live açık");
  }

  const { writeAudit } = await import("../src/engines/audit.js");
  await writeAudit({
    category: "autonomy",
    action: "approval.owner_tp5e004",
    actorKind: "owner",
    summary: "T-P5E-004 Owner onayı: CTO+Developer gerçek yerel LLM pilotu (max 2).",
    metadata: {
      taskId: "T-P5E-004",
      type: "real_ai_provider_pilot",
      agentIds: ["cto", "developer"],
      taskIds: [CTO_ID, DEV_ID],
      model: "qwen2.5:14b",
      codeChangeAllowed: false,
      cloudAllowed: false,
      continuousAutomation: false,
    },
  });

  const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
  resetModelProviderForTests();

  const { runLocalAgentExecutionPass } = await import("../src/ai/local-agent-execution.js");
  const started = Date.now();
  const result = await runLocalAgentExecutionPass({
    limit: 2,
    taskIds: [CTO_ID, DEV_ID],
    agentIds: ["cto", "developer"],
  });

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const prisma = getPrisma();
  const tasks = await prisma.task.findMany({
    where: { id: { in: [CTO_ID, DEV_ID] } },
    include: { project: true },
  });
  const messages = await prisma.agentMessage.findMany({
    where: { taskId: { in: [CTO_ID, DEV_ID] }, kind: "result" },
    orderBy: { createdAt: "asc" },
  });

  const envelope = {
    taskId: "T-P5E-004",
    wallClockMs: Date.now() - started,
    result,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId,
      status: t.status,
      model: t.model,
      executionKind: t.executionKind,
      blockedReason: t.blockedReason,
      projectSlug: t.project.slug,
      executionResult: t.executionResult,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      from: m.fromAgentId,
      to: m.toAgentId,
      kind: m.kind,
      summary: m.summary,
      payloadJson: m.payloadJson,
    })),
  };
  writeFileSync(OUT, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const realCount = result.processed.filter((p) => p.realAiExecution).length;
  console.log(
    JSON.stringify(
      {
        ok: realCount >= 1 && result.cloudStarted === false,
        realAiCalls: realCount,
        processed: result.processed.map((p) => ({
          taskId: p.taskId,
          assigneeId: p.assigneeId,
          realAiExecution: p.realAiExecution,
          channel: p.channel,
          status: p.status,
          acceptanceMet: p.acceptanceMet,
          codeChangeApplied: p.codeChangeApplied,
          modelId: p.modelId,
          durationMs: p.durationMs,
          skippedReason: p.skippedReason,
        })),
        wallClockMs: envelope.wallClockMs,
      },
      null,
      2,
    ),
  );

  await disconnectPrisma();
  if (realCount < 1) process.exit(3);
  if (result.processed.some((p) => p.codeChangeApplied)) process.exit(4);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
