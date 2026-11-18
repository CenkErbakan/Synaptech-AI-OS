/**
 * T-P5E-002 — onaylı 231 görevi güvenli arşivle (silme yok).
 * Onaylı DRY RUN SHA: DBB7D4A543DFBAB3DCF565186326E454275C78648DD94B03F6254EEE31E6A3A5
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const APPROVED_JSON_SHA =
  "DBB7D4A543DFBAB3DCF565186326E454275C78648DD94B03F6254EEE31E6A3A5";
const KEEP_IDS = new Set([
  "8ca354e8-f25b-432d-acc5-73105f3e5a89", // T-P4B-001
  "462490ee-bbf4-4ec3-b2ac-59e8134966ce", // AI CEO Chat
]);
const ARCHIVE_REASON = "T-P5E-002: DRY RUN onaylı test/simülasyon/mock panosu temizliği";

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (c) => hash.update(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function main() {
  const root = path.resolve(process.cwd(), "../..");
  const dryRunPath = path.join(root, "reports/qa/faz-5e-task-board-cleanup-dry-run.json");
  const idsPath = path.join(root, "reports/qa/faz-5e-task-archive-ids.json");
  const backupDir = path.join(root, "reports/qa/backups");
  mkdirSync(backupDir, { recursive: true });

  const actualSha = await sha256File(dryRunPath);
  if (actualSha !== APPROVED_JSON_SHA) {
    throw new Error(`DRY RUN hash uyuşmuyor. expected=${APPROVED_JSON_SHA} actual=${actualSha}`);
  }

  const dry = JSON.parse(readFileSync(dryRunPath, "utf8")) as {
    all: Array<{ id: string; cls: string; status: string; title: string }>;
  };
  const archiveClasses = new Set([
    "archive_test_sim",
    "archive_auto_deterministic",
    "archive_mock_cloud",
    "archive_growth_sim",
  ]);
  const ids = dry.all.filter((r) => archiveClasses.has(r.cls)).map((r) => r.id);
  const unique = [...new Set(ids)];
  if (unique.length !== 231) {
    throw new Error(`Arşiv ID adedi 231 değil: ${unique.length}. Durduruldu.`);
  }
  for (const id of unique) {
    if (KEEP_IDS.has(id)) throw new Error(`Korunan ID arşiv listesinde: ${id}`);
  }

  // IDs dosyası ile çapraz kontrol
  const fromFile = JSON.parse(readFileSync(idsPath, "utf8")) as { ids: string[]; count: number };
  if (fromFile.count !== 231) throw new Error("ids dosyası count != 231");
  const setA = new Set(unique);
  const setB = new Set(fromFile.ids);
  if (setA.size !== setB.size || [...setA].some((id) => !setB.has(id))) {
    throw new Error("DRY RUN ID kümesi ile ids dosyası uyuşmuyor. Durduruldu.");
  }

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { acquireLease, releaseLease, resetWorkerIdForTests } = await import(
    "../src/engines/worker-lease.js"
  );
  const { SCHEDULER_LEASE_KEY } = await import("../src/engines/autonomy-scheduler.js");
  const { writeAudit } = await import("../src/engines/audit.js");

  resetWorkerIdForTests("archive-tp5e002");
  const prisma = getPrisma();

  const liveActive = await prisma.agentRun.count({
    where: {
      executionMode: "live",
      cursorStatus: { in: ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"] },
    },
  });
  if (liveActive > 0) {
    throw new Error(`Aktif live Cloud run var (${liveActive}). Arşiv iptal.`);
  }

  let lease = await acquireLease(SCHEDULER_LEASE_KEY, 180_000, { purpose: "T-P5E-002-archive" });
  if (!lease.acquired) {
    console.warn("Scheduler lease meşgul — 35s bekleniyor (TTL dolumu)...");
    await new Promise((r) => setTimeout(r, 35_000));
    // Süresi dolmuş lease çalınabilir
    lease = await acquireLease(SCHEDULER_LEASE_KEY, 180_000, { purpose: "T-P5E-002-archive-retry" });
  }
  if (!lease.acquired) {
    throw new Error(`Scheduler lease alınamadı (${lease.reason}). Yarış riski — durduruldu.`);
  }

  try {
    const beforeTotal = await prisma.task.count();
    const beforeActive = await prisma.task.count({ where: { archivedAt: null } });
    const candidates = await prisma.task.findMany({
      where: { id: { in: unique }, archivedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        projectId: true,
        origin: true,
        chainId: true,
        parentTaskId: true,
        updatedAt: true,
      },
    });
    if (candidates.length !== 231) {
      throw new Error(
        `DB'de arşivlenecek aktif adet ${candidates.length} (beklenen 231). Küme değişmiş olabilir.`,
      );
    }

    const keepBefore = await prisma.task.findMany({
      where: { id: { in: [...KEEP_IDS] } },
      select: { id: true, title: true, status: true, archivedAt: true, updatedAt: true },
    });
    if (keepBefore.length !== 2) throw new Error("Korunan 2 görev bulunamadı.");
    const tp4b = keepBefore.find((t) => t.id === "8ca354e8-f25b-432d-acc5-73105f3e5a89");
    if (!tp4b || tp4b.status !== "in_review") {
      throw new Error("T-P4B-001 in_review değil — durduruldu.");
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `tp5e002-pre-archive-${stamp}.json`);
    writeFileSync(
      backupPath,
      `${JSON.stringify(
        {
          approvedSha: APPROVED_JSON_SHA,
          createdAt: new Date().toISOString(),
          beforeTotal,
          beforeActive,
          keepBefore,
          candidates,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: {
          id: { in: unique },
          archivedAt: null,
        },
        data: {
          archivedAt: now,
          archivedReason: ARCHIVE_REASON,
        },
      });
      if (updated.count !== 231) {
        throw new Error(`Transaction update count=${updated.count}, beklenen 231 — rollback`);
      }
      // Korunanlar değişmemeli
      const keepCheck = await tx.task.findMany({
        where: { id: { in: [...KEEP_IDS] } },
        select: { id: true, status: true, archivedAt: true },
      });
      for (const k of keepCheck) {
        if (k.archivedAt !== null) throw new Error(`Korunan görev arşivlendi: ${k.id}`);
      }
      const tp = keepCheck.find((k) => k.id === "8ca354e8-f25b-432d-acc5-73105f3e5a89");
      if (!tp || tp.status !== "in_review") throw new Error("T-P4B-001 status bozuldu");
      return updated.count;
    });

    const afterActive = await prisma.task.count({ where: { archivedAt: null } });
    const afterArchived = await prisma.task.count({ where: { archivedAt: { not: null } } });
    const afterTotal = await prisma.task.count();

    await writeAudit({
      category: "task",
      action: "task.board_archive_tp5e002",
      actorKind: "owner",
      summary: `T-P5E-002: ${result} görev arşivlendi (silinmedi). Aktif=${afterActive}, arşiv=${afterArchived}.`,
      metadata: {
        approvedSha: APPROVED_JSON_SHA,
        archivedCount: result,
        backupPath,
        keepIds: [...KEEP_IDS],
      },
    });

    const summary = {
      ok: true,
      archivedCount: result,
      before: { total: beforeTotal, active: beforeActive },
      after: { total: afterTotal, active: afterActive, archived: afterArchived },
      keep: keepBefore.map((k) => ({ id: k.id, title: k.title, status: k.status })),
      backupPath,
      approvedSha: APPROVED_JSON_SHA,
    };
    const summaryPath = path.join(root, "reports/qa/faz-5e-task-archive-apply-result.json");
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await releaseLease(SCHEDULER_LEASE_KEY).catch(() => undefined);
    await disconnectPrisma();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
