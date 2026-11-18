/**
 * Owner onaylı: yeni operationEpoch. Silme yok. Dry-run + backup sonra yaz.
 * Kullanım: pnpm --filter @synaptech/api exec tsx scripts/start-ops-epoch.ts [--apply]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { getPrisma, disconnectPrisma } from "../src/db/prisma.js";
import { countEpochTasks, readOperationEpoch, startOperationEpoch } from "../src/engines/operation-epoch.js";

const apply = process.argv.includes("--apply");

async function main() {
  const prisma = getPrisma();
  const beforeEpoch = await readOperationEpoch();
  const openStatuses = ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] as const;
  const [openTasks, pendingApprovals, agents, projects, goals, audits] = await Promise.all([
    prisma.task.findMany({
      where: { archivedAt: null, source: "real", status: { in: [...openStatuses] } },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.approval.count({ where: { status: "pending", source: "real" } }),
    prisma.agent.count(),
    prisma.project.count(),
    prisma.companyGoal.count(),
    prisma.auditLog.count(),
  ]);

  const backup = {
    dryRun: !apply,
    at: new Date().toISOString(),
    previousEpoch: beforeEpoch,
    counts: {
      openTasks: openTasks.length,
      pendingApprovals,
      agents,
      projects,
      goals,
      audits,
    },
    openTaskIds: openTasks.map((t) => t.id),
    note: "Görev/onay/audit satırları kopyalanmadı; kimlik listesi geri alma için yeterli. Silme yok.",
  };

  const dir = path.resolve(process.cwd(), "../../reports/ops");
  mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `epoch-backup-${Date.now()}.json`);
  writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  if (!apply) {
    console.log(
      JSON.stringify(
        { ok: true, apply: false, backupPath, ...backup.counts, previousEpoch: beforeEpoch },
        null,
        2,
      ),
    );
    return;
  }

  const epoch = await startOperationEpoch({
    id: `ops-${new Date().toISOString().slice(0, 10)}`,
    note: "Owner onaylı fresh start. SystemSetting only. Silme yok.",
    actor: "owner",
  });
  const after = await countEpochTasks(epoch);
  console.log(JSON.stringify({ ok: true, apply: true, backupPath, epoch, after }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
