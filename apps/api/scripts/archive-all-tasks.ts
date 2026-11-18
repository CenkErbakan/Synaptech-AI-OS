/**
 * Owner: tüm aktif görevleri arşivle (silme yok). --apply ile yazar.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { writeAudit } from "../src/engines/audit.js";
import { countEpochTasks, readOperationEpoch } from "../src/engines/operation-epoch.js";

const apply = process.argv.includes("--apply");

async function main() {
  const prisma = getPrisma();
  const active = await prisma.task.findMany({
    where: { archivedAt: null },
    select: { id: true, title: true, status: true, source: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const alreadyArchived = await prisma.task.count({ where: { archivedAt: { not: null } } });

  const dir = path.resolve(process.cwd(), "../../reports/ops");
  mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `task-archive-backup-${Date.now()}.json`);
  writeFileSync(
    backupPath,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        apply,
        activeCount: active.length,
        alreadyArchived,
        ids: active.map((t) => t.id),
        note: "Görev satırları silinmedi; archivedAt set edilir. Geri alma: archivedAt=null.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (!apply) {
    console.log(JSON.stringify({ ok: true, apply: false, backupPath, activeCount: active.length, alreadyArchived }, null, 2));
    return;
  }

  const now = new Date();
  const result = await prisma.task.updateMany({
    where: { archivedAt: null },
    data: {
      archivedAt: now,
      archivedReason: "Owner: tüm görevler arşivlendi (silme yok).",
    },
  });
  await writeAudit({
    category: "ops",
    action: "ops.tasks_archived_all",
    actorKind: "owner",
    summary: `Aktif görevler arşivlendi: ${result.count}`,
    metadata: { count: result.count, backupPath, realAiExecution: false, deleted: false },
  });
  const epoch = await readOperationEpoch();
  const after = await countEpochTasks(epoch);
  const stillActive = await prisma.task.count({ where: { archivedAt: null } });
  const archived = await prisma.task.count({ where: { archivedAt: { not: null } } });
  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: true,
        backupPath,
        archivedNow: result.count,
        stillActive,
        archivedTotal: archived,
        epochAfter: after,
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
