/**
 * Aktif Cloud run sayısı (MSSQL). Secret yazdırmaz. Live create yok.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const ACTIVE = ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"];
const prisma = new PrismaClient();

try {
  const active = await prisma.agentRun.count({
    where: {
      cursorStatus: { in: ACTIVE },
      OR: [{ executionMode: "mock" }, { executionMode: "live" }],
    },
  });
  const recent = await prisma.agentRun.findMany({
    where: {
      OR: [{ cursorAgentId: { not: null } }, { executionMode: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      cursorStatus: true,
      executionMode: true,
      cursorAgentId: true,
      cursorRunId: true,
      createdAt: true,
    },
  });
  const pendingApprovals = await prisma.approval.count({
    where: { type: "cloud_agent_run", status: "pending", source: "real" },
  });
  const approvedCloud = await prisma.approval.count({
    where: { type: "cloud_agent_run", status: "approved", source: "real" },
  });
  console.log(
    JSON.stringify(
      {
        activeCloudRuns: active,
        pendingCloudApprovals: pendingApprovals,
        approvedCloudApprovals: approvedCloud,
        recentRuns: recent.map((r) => ({
          id: r.id,
          status: r.status,
          cursorStatus: r.cursorStatus,
          executionMode: r.executionMode,
          hasCursorIds: Boolean(r.cursorAgentId && r.cursorRunId),
          createdAt: r.createdAt.toISOString(),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
