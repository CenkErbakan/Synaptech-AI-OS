/**
 * Owner: stale mock AgentRun → cancelled. Kayıt silinmez. Gerçek Cursor run yok.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const TARGET = "0e1d05eb-67d3-412d-b41b-5591a87037b1";

const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
const { writeAudit } = await import("../src/engines/audit.js");
const { resetEnvCacheForTests, getEnv } = await import("../src/lib/env.js");
resetEnvCacheForTests();
getEnv();

const prisma = getPrisma();

try {
  const row = await prisma.agentRun.findUnique({ where: { id: TARGET } });
  if (!row) {
    console.log(JSON.stringify({ ok: false, error: "run_not_found", id: TARGET }));
    process.exit(2);
  }
  if (row.executionMode !== "mock") {
    console.log(
      JSON.stringify({
        ok: false,
        error: "not_mock",
        executionMode: row.executionMode,
        cursorStatus: row.cursorStatus,
      }),
    );
    process.exit(2);
  }
  if (!["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(String(row.cursorStatus || ""))) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "not_active_cursor_status",
        cursorStatus: row.cursorStatus,
        status: row.status,
      }),
    );
    process.exit(2);
  }

  const updated = await prisma.agentRun.update({
    where: { id: TARGET },
    data: {
      status: "cancelled",
      cursorStatus: "CANCELLED",
      message:
        "Owner: stale mock CREATING kaydı kapatıldı (Cursor API'de agent 404; gerçek run yok). Kayıt korundu.",
      errorMessage: "stale_mock_creating_closed",
      finishedAt: new Date(),
      cancelVerified: false,
    },
  });

  await writeAudit({
    category: "cloud",
    action: "cloud.stale_mock_closed",
    actorKind: "owner",
    targetType: "agent_run",
    targetId: TARGET,
    summary: "Stale mock CREATING run cancelled; no real Cursor counterpart (404).",
    metadata: {
      previousStatus: row.status,
      previousCursorStatus: row.cursorStatus,
      executionMode: row.executionMode,
      cursorAgentId: row.cursorAgentId,
      cursorRunId: row.cursorRunId,
    },
  });

  const active = await prisma.agentRun.count({
    where: {
      cursorStatus: { in: ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"] },
      OR: [{ executionMode: "mock" }, { executionMode: "live" }],
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: updated.id,
        status: updated.status,
        cursorStatus: updated.cursorStatus,
        executionMode: updated.executionMode,
        finishedAt: updated.finishedAt?.toISOString() ?? null,
        activeCloudRunsAfter: active,
        deleted: false,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectPrisma();
}
