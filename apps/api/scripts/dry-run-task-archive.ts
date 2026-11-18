/**
 * Salt okunur DRY RUN — görev panosu arşiv adayları.
 * Toplu UPDATE/DELETE yapmaz.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { writeFileSync } from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

type Class =
  | "keep_owner"
  | "keep_cloud_pilot"
  | "keep_ambiguous_review"
  | "archive_test_sim"
  | "archive_auto_deterministic"
  | "archive_mock_cloud"
  | "archive_growth_sim";

function classify(t: {
  title: string;
  origin: string | null;
  chainId: string | null;
  chainStep: string | null;
  parentTaskId: string | null;
  executionKind: string | null;
  description: string;
  idempotencyKey: string | null;
  runs: Array<{ executionMode: string | null; cursorStatus: string | null; reconcileState: string | null }>;
}): { cls: Class; reason: string } {
  const title = t.title.toLowerCase();
  const origin = (t.origin ?? "").toLowerCase();
  const desc = t.description.toLowerCase();
  const idem = (t.idempotencyKey ?? "").toLowerCase();
  const hasLive = t.runs.some((r) => r.executionMode === "live");
  const hasMock = t.runs.some((r) => r.executionMode === "mock");

  // Korunanlar
  if (
    title.includes("ceo chat") ||
    title.includes("ekip iletişim") ||
    title.includes("ai ceo chat")
  ) {
    return { cls: "keep_owner", reason: "Owner: AI CEO Chat + Ekip İletişimi" };
  }
  if (
    title.includes("t-p4b-001") ||
    idem.includes("t-p4b-001") ||
    origin.includes("t-p4b-001") ||
    desc.includes("t-p4b-001") ||
    hasLive
  ) {
    return { cls: "keep_cloud_pilot", reason: "Gerçek Cloud pilot / live run — korunur" };
  }

  // Büyüme simülasyon zinciri
  if (
    desc.includes("growth") &&
    (t.chainStep?.startsWith("growth") ||
      ["seo_scan", "research_leads", "content_draft", "ads_proposal", "ceo_growth_close"].includes(
        t.chainStep ?? "",
      ))
  ) {
    return { cls: "archive_growth_sim", reason: "Faz 5C büyüme deterministik/simülasyon zinciri" };
  }

  // Yazılım teslim simülasyon / deterministik zincir
  if (t.chainId && t.executionKind === "deterministic") {
    return {
      cls: "archive_test_sim",
      reason: "Deterministik koordinasyon zinciri (simülasyon/test)",
    };
  }
  if (
    desc.includes("deterministik") ||
    desc.includes("mock") ||
    desc.includes("llm değil") ||
    desc.includes("gerçek ai yürütmesi yok") ||
    title.includes("faz5b") ||
    title.includes("e2e") ||
    idem.includes("faz5b") ||
    idem.includes("integration")
  ) {
    return { cls: "archive_test_sim", reason: "Test/simülasyon/mock metin imzası" };
  }

  // Otomatik CEO fırsat zinciri
  if (origin.startsWith("opportunity:") || idem.startsWith("auto-ceo") || idem.startsWith("ai-ceo")) {
    return {
      cls: "archive_auto_deterministic",
      reason: "Otonom/deterministik CEO veya AI pipeline üretimi",
    };
  }

  if (hasMock && !hasLive) {
    return { cls: "archive_mock_cloud", reason: "Yalnızca mock Cloud run bağlı" };
  }

  // Belirsiz — otomatik arşivleme YOK
  return {
    cls: "keep_ambiguous_review",
    reason: "Kaynak belirsiz — Owner incelemesi; DRY RUN otomatik arşivlemez",
  };
}

async function main() {
  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const prisma = getPrisma();

  const activeLive = await prisma.agentRun.count({
    where: {
      executionMode: "live",
      cursorStatus: { in: ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"] },
    },
  });

  const tasks = await prisma.task.findMany({
    include: {
      project: true,
      runs: {
        select: {
          id: true,
          executionMode: true,
          cursorStatus: true,
          reconcileState: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const buckets: Record<Class, typeof rows> = {
    keep_owner: [],
    keep_cloud_pilot: [],
    keep_ambiguous_review: [],
    archive_test_sim: [],
    archive_auto_deterministic: [],
    archive_mock_cloud: [],
    archive_growth_sim: [],
  } as never;

  type Row = {
    id: string;
    title: string;
    status: string;
    project: string;
    origin: string | null;
    chainStep: string | null;
    parentTaskId: string | null;
    executionKind: string | null;
    cls: Class;
    reason: string;
    runModes: string[];
  };
  const rows: Row[] = [];

  for (const t of tasks) {
    const { cls, reason } = classify({
      title: t.title,
      origin: t.origin,
      chainId: t.chainId,
      chainStep: t.chainStep,
      parentTaskId: t.parentTaskId,
      executionKind: t.executionKind,
      description: t.description,
      idempotencyKey: t.idempotencyKey,
      runs: t.runs,
    });
    const row: Row = {
      id: t.id,
      title: t.title.slice(0, 100),
      status: t.status,
      project: t.project.slug,
      origin: t.origin,
      chainStep: t.chainStep,
      parentTaskId: t.parentTaskId,
      executionKind: t.executionKind,
      cls,
      reason,
      runModes: [...new Set(t.runs.map((r) => r.executionMode ?? "null"))],
    };
    rows.push(row);
    (buckets[cls] as Row[]).push(row);
  }

  // Parent arşivlenirse çocuklar da aynı pakette sayılmalı (ilişki korunur, silinmez)
  const archiveClasses = new Set<Class>([
    "archive_test_sim",
    "archive_auto_deterministic",
    "archive_mock_cloud",
    "archive_growth_sim",
  ]);
  const archiveIds = new Set(rows.filter((r) => archiveClasses.has(r.cls)).map((r) => r.id));
  // Zincir parent'ı arşiv adayıysa tüm zincir adımlarını da adaya ekle (rapor)
  for (const t of tasks) {
    if (t.parentTaskId && archiveIds.has(t.parentTaskId) && !archiveIds.has(t.id)) {
      const existing = rows.find((r) => r.id === t.id);
      if (existing && !archiveClasses.has(existing.cls)) {
        existing.cls = "archive_test_sim";
        existing.reason = `Parent arşiv adayı (${t.parentTaskId.slice(0, 8)}…) — zincir bütünlüğü`;
        archiveIds.add(t.id);
      }
    }
  }

  const counts = Object.fromEntries(
    (Object.keys(buckets) as Class[]).map((k) => [k, rows.filter((r) => r.cls === k).length]),
  );
  const wouldArchive = rows.filter((r) => archiveClasses.has(r.cls));
  const wouldKeep = rows.filter((r) => !archiveClasses.has(r.cls));

  const mockStale = await prisma.agentRun.findMany({
    where: {
      executionMode: "mock",
      OR: [
        { reconcileState: "stale_mock" },
        {
          cursorStatus: { in: ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"] },
          createdAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
        },
      ],
    },
    select: { id: true, taskId: true, cursorStatus: true, reconcileState: true, createdAt: true },
    take: 100,
  });

  const report = {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    activeLiveCloudRuns: activeLive,
    archiveBlockedIfLiveActive: activeLive > 0,
    totalTasks: tasks.length,
    counts,
    wouldArchiveCount: wouldArchive.length,
    wouldKeepCount: wouldKeep.length,
    note:
      "Belirsiz kayıtlar otomatik arşivlenmez (keep_ambiguous_review). Toplu arşiv Owner onayı olmadan uygulanmaz.",
    schemaGap: {
      archivedAt: false,
      archivedReason: false,
      plannedMigration: "Task.archivedAt DateTime?, Task.archivedReason NVarChar(500)?",
    },
    mockStaleOrOldCreating: mockStale.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      cursorStatus: r.cursorStatus,
      reconcileState: r.reconcileState,
      createdAt: r.createdAt.toISOString(),
    })),
    keepSamples: wouldKeep.slice(0, 30),
    archiveSamples: wouldArchive.slice(0, 80),
    all: rows,
  };

  const outPath = path.resolve(
    process.cwd(),
    "../../reports/qa/faz-5e-task-board-cleanup-dry-run.json",
  );
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        totalTasks: report.totalTasks,
        counts: report.counts,
        wouldArchiveCount: report.wouldArchiveCount,
        wouldKeepCount: report.wouldKeepCount,
        activeLiveCloudRuns: report.activeLiveCloudRuns,
      },
      null,
      2,
    ),
  );

  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
