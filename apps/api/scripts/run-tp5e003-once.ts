/**
 * T-P5E-003 — tek gerçek yerel AI CEO scheduler döngüsü.
 * Sonunda MODE=off beklenir (çağıran kapatır).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT = path.resolve(process.cwd(), "../../reports/qa/faz-5e-tp5e003-live-result.json");
const SUFFIX = "T-P5E-003-2026-11-18";

async function main() {
  const { resetEnvCacheForTests } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  const { getEnv } = await import("../src/lib/env.js");
  const env = getEnv();
  if (env.SCHEDULER_AI_CEO_MODE !== "local") {
    throw new Error(`SCHEDULER_AI_CEO_MODE=${env.SCHEDULER_AI_CEO_MODE}, local bekleniyor`);
  }
  if (env.MODEL_PROVIDER !== "local") {
    throw new Error(`MODEL_PROVIDER=${env.MODEL_PROVIDER}, local bekleniyor`);
  }
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    throw new Error("Cloud live açık — iptal");
  }

  const { resetModelProviderForTests } = await import("../src/ai/providers/registry.js");
  resetModelProviderForTests();
  const { ensureDefaultGoalsAndPolicies } = await import("../src/engines/autonomy-scheduler.js");
  await ensureDefaultGoalsAndPolicies();

  const { runScheduledAiCeoCycle } = await import("../src/ai/ai-ceo-scheduler.js");
  const { dispatchAutonomousChildren } = await import("../src/engines/autonomy-dispatch.js");

  const started = Date.now();
  const result = await runScheduledAiCeoCycle({ idempotencySuffix: SUFFIX });
  let dispatch: unknown = null;
  if (result.parentTaskId) {
    dispatch = await dispatchAutonomousChildren(result.parentTaskId);
  }

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const prisma = getPrisma();
  const children = result.parentTaskId
    ? await prisma.task.findMany({
        where: { parentTaskId: result.parentTaskId },
        include: { project: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const messages = result.parentTaskId
    ? await prisma.agentMessage.findMany({
        where: { parentTaskId: result.parentTaskId },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const envelope = {
    taskId: "T-P5E-003",
    wallClockMs: Date.now() - started,
    suffix: SUFFIX,
    result,
    dispatch,
    children: children.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      assigneeId: c.assigneeId,
      projectSlug: c.project.slug,
      model: c.model,
      blockedReason: c.blockedReason,
      executionKind: c.executionKind,
      executionResult: c.executionResult,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      from: m.fromAgentId,
      to: m.toAgentId,
      kind: m.kind,
      summary: m.summary,
    })),
  };
  writeFileSync(OUT, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: !result.skippedReason || Boolean(result.parentTaskId),
        skippedReason: result.skippedReason,
        realAiExecution: result.realAiExecution,
        modelId: result.modelId,
        durationMs: result.durationMs,
        jsonValid: result.jsonValid,
        grounding: result.grounding,
        parentTaskId: result.parentTaskId,
        childCount: result.childTaskIds.length,
        messageCount: result.messageIds.length,
        cloudStarted: result.cloudStarted,
        wallClockMs: envelope.wallClockMs,
      },
      null,
      2,
    ),
  );
  await disconnectPrisma();
  if (result.skippedReason && !result.parentTaskId) process.exit(2);
  if (result.realAiExecution !== true) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
