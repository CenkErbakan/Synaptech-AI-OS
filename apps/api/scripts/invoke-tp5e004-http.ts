/**
 * T-P5E-004 — Owner token ile POST /api/ai/agents/execute (token basılmaz).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT = path.resolve(process.cwd(), "../../reports/qa/faz-5e-tp5e004-live-result.json");
const CTO_ID = "e8e0cfc6-e98b-4b70-966d-60b5c33398eb";
const DEV_ID = "e07d1fd4-20f4-44e2-86cf-b75415c0f89d";
const BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:3101";

async function main() {
  const token = process.env.SYNAPTECH_OWNER_TOKEN;
  if (!token) throw new Error("SYNAPTECH_OWNER_TOKEN yok");

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
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

  const started = Date.now();
  const res = await fetch(`${BASE}/api/ai/agents/execute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      limit: 2,
      taskIds: [CTO_ID, DEV_ID],
      agentIds: ["cto", "developer"],
    }),
  });
  const text = await res.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    result = { raw: text };
  }
  if (!res.ok) {
    writeFileSync(OUT, `${JSON.stringify({ httpStatus: res.status, result }, null, 2)}\n`, "utf8");
    console.error(JSON.stringify({ ok: false, httpStatus: res.status }, null, 2));
    process.exit(2);
  }

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
    httpStatus: res.status,
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

  const processed =
    (result as { processed?: Array<Record<string, unknown>> }).processed ?? [];
  const realCount = processed.filter((p) => p.realAiExecution === true).length;
  console.log(
    JSON.stringify(
      {
        ok: realCount >= 1 && (result as { cloudStarted?: boolean }).cloudStarted === false,
        httpStatus: res.status,
        realAiCalls: realCount,
        continuousAutomation: (result as { continuousAutomation?: boolean }).continuousAutomation,
        processed: processed.map((p) => ({
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
        out: OUT,
      },
      null,
      2,
    ),
  );

  await disconnectPrisma();
  if (realCount < 1) process.exit(3);
  if (processed.some((p) => p.codeChangeApplied === true)) process.exit(4);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
