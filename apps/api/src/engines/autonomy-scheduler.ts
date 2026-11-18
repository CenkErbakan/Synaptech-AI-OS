import { runScheduledAiCeoCycle } from "../ai/ai-ceo-scheduler.js";
import { getEnv } from "../lib/env.js";
import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";
import { runDeterministicCeoCycle } from "./ceo-orchestrator.js";
import { dispatchAutonomousChildren } from "./autonomy-dispatch.js";
import { runGrowthAutonomyCycle } from "./growth-coordination.js";
import { runReconciliationPass } from "./run-reconciliation.js";
import {
  acquireLease,
  getWorkerId,
  heartbeatWorkerInstance,
  releaseLease,
  renewLease,
} from "./worker-lease.js";
import type { TickTrigger } from "./automation-runtime.js";

export const SCHEDULER_LEASE_KEY = "scheduler:tick";
/** Yerel Qwen döngüsü 30s lease'ten uzun sürer; tick boyunca yenilenir. */
const SCHEDULER_TICK_LEASE_MS = 8 * 60_000;

let timer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let ticking = false;
let lastTickAt: Date | null = null;
let lastTickTrigger: TickTrigger = "none";
let lastTickSummary: { ran: number; skipped: number; leaseHeld: boolean; trigger: TickTrigger } | null =
  null;

function intervalMinutesFromCron(cronExpr: string): number {
  const star = cronExpr.match(/^\*\/(\d+)\s/);
  if (star) return Math.max(1, Number(star[1]));
  if (cronExpr.startsWith("0 ")) return 60; // hourly-ish fallback
  return 5;
}

function isDue(lastFinishedAt: Date | null, cronExpr: string, now: Date): boolean {
  if (!lastFinishedAt) return true;
  const mins = intervalMinutesFromCron(cronExpr);
  return now.getTime() - lastFinishedAt.getTime() >= mins * 60_000;
}

export async function ensureDefaultAutonomyJobs(): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  const jobs = [
    {
      jobKey: "daily-ceo-review",
      title: "Günlük CEO değerlendirmesi (SCHEDULER_AI_CEO_MODE; varsayılan off=deterministik)",
      cronExpr: "*/2 * * * *",
      handler: "ceo_cycle",
      timeoutSec: 360,
    },
    {
      jobKey: "run-reconciliation",
      title: "Cloud run reconciliation",
      cronExpr: "*/5 * * * *",
      handler: "reconciliation",
      timeoutSec: 120,
    },
    {
      jobKey: "growth-cycle",
      title: "Faz 5C büyüme döngüsü (izinli kamu tarama)",
      cronExpr: "*/10 * * * *",
      handler: "growth_cycle",
      timeoutSec: 300,
    },
    {
      jobKey: "local-agent-pass",
      title: "Dağıtıma hazır yerel ajan işleri (CEO döngüsünden bağımsız)",
      cronExpr: "*/1 * * * *",
      handler: "agent_pass",
      timeoutSec: 360,
    },
  ] as const;

  for (const job of jobs) {
    await prisma.scheduledJob.upsert({
      where: { jobKey: job.jobKey },
      create: {
        ...job,
        timezone: "Europe/Istanbul",
        enabled: true,
        maxRetries: 1,
        updatedAt: now,
      },
      update: {
        title: job.title,
        cronExpr: job.cronExpr,
        handler: job.handler,
        timeoutSec: job.timeoutSec,
        updatedAt: now,
      },
    });
  }
}

export async function ensureDefaultGoalsAndPolicies(): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  const goals = [
    {
      goalKey: "os-reliability",
      projectSlug: "synaptech-ai-os",
      title: "AI OS güvenilir operasyon",
      description: "Görev motoru ve otonom döngünün denetimli çalışması.",
      kpiLabel: "Başarılı otonom döngü / gün",
      targetValue: "1",
      currentValue: null,
      dataSource: "mssql:ScheduledJobRun",
      department: "Yönetim",
    },
    {
      goalKey: "website-seo",
      projectSlug: "synaptech",
      title: "Kurumsal site SEO görünürlüğü",
      description: "Organik görünürlük; metrik kaynağı bağlı değilse currentValue null.",
      kpiLabel: "Organik tıklama",
      targetValue: null,
      currentValue: null,
      dataSource: "not_connected",
      department: "Büyüme",
    },
    {
      goalKey: "subify-quality",
      projectSlug: "subify",
      title: "Subify kalite ve teknik borç",
      description: "Test ve hata sinyallerinden kalite fırsatları.",
      kpiLabel: "Açık kalite fırsatı",
      targetValue: null,
      currentValue: null,
      dataSource: "mssql:Opportunity",
      department: "Yazılım",
    },
    {
      goalKey: "marivo-growth",
      projectSlug: "marivo",
      title: "Marivo ürün geliştirme fırsatları",
      description: "Pazar/ürün fırsatları; uydurma KPI yok.",
      kpiLabel: "Doğrulanmış fırsat",
      targetValue: null,
      currentValue: null,
      dataSource: "mssql:Opportunity",
      department: "Büyüme",
    },
  ] as const;

  for (const g of goals) {
    await prisma.companyGoal.upsert({
      where: { goalKey: g.goalKey },
      create: { ...g, priority: "medium", status: "active", updatedAt: now },
      update: {
        title: g.title,
        description: g.description,
        dataSource: g.dataSource,
        updatedAt: now,
      },
    });
  }

  await prisma.autonomyPolicy.upsert({
    where: { policyKey: "auto-local-planning" },
    create: {
      policyKey: "auto-local-planning",
      actionType: "task_planning",
      authority: "AUTO",
      maxRisk: "low",
      enabled: true,
      updatedAt: now,
    },
    update: { enabled: true, updatedAt: now },
  });

  await prisma.autonomyPolicy.upsert({
    where: { policyKey: "policy-auto-cloud-blocked-faz5a" },
    create: {
      policyKey: "policy-auto-cloud-blocked-faz5a",
      actionType: "cloud_agent_run",
      authority: "POLICY-AUTO",
      maxRisk: "medium",
      maxUsageTokens: 0,
      enabled: false,
      updatedAt: now,
    },
    update: { enabled: false, maxUsageTokens: 0, updatedAt: now },
  });

  // Zamanlanmış yerel AI CEO — varsayılan kapalı (Owner onayı olmadan açılmaz)
  const aiMode = getEnv().SCHEDULER_AI_CEO_MODE;
  await prisma.autonomyPolicy.upsert({
    where: { policyKey: "scheduler-local-ai-ceo" },
    create: {
      policyKey: "scheduler-local-ai-ceo",
      actionType: "task_planning",
      authority: "OWNER-APPROVAL",
      maxRisk: "medium",
      maxUsageTokens: 0,
      enabled: aiMode !== "off",
      updatedAt: now,
    },
    update: {
      enabled: aiMode !== "off",
      authority: "OWNER-APPROVAL",
      updatedAt: now,
    },
  });
}

async function executeHandler(handler: string): Promise<unknown> {
  if (handler === "reconciliation") {
    return runReconciliationPass();
  }
  if (handler === "ceo_cycle") {
    const mode = getEnv().SCHEDULER_AI_CEO_MODE;
    const { runControlledAutonomyTick } = await import("./autonomy-tick-orchestrator.js");
    if (mode === "mock" || mode === "local") {
      // Gerçek/mock AI yolu — deterministik ile karıştırılmaz
      const ai = await runScheduledAiCeoCycle();
      if (ai.parentTaskId) {
        await dispatchAutonomousChildren(ai.parentTaskId);
      }
      // Kontrollü otonomi: varsayılan off — ajan pass yalnızca Owner gate açıkken
      const controlled = await runControlledAutonomyTick({ ceoCycleResult: ai });
      return { kind: "ai_ceo" as const, ...ai, controlledAutonomy: controlled };
    }
    const cycle = await runDeterministicCeoCycle();
    if (cycle.parentTaskId) {
      await dispatchAutonomousChildren(cycle.parentTaskId);
    }
    const controlled = await runControlledAutonomyTick({ ceoCycleResult: cycle });
    return { kind: "deterministic" as const, ...cycle, controlledAutonomy: controlled };
  }
  if (handler === "growth_cycle") {
    return runGrowthAutonomyCycle();
  }
  if (handler === "agent_pass") {
    const { runControlledAutonomyTick } = await import("./autonomy-tick-orchestrator.js");
    return runControlledAutonomyTick({ skipCeo: true });
  }
  return { skipped: true, reason: `unknown_handler:${handler}` };
}

/** Tek tick: due job’ları çalıştırır (lease + idempotent). */
export async function schedulerTick(
  now = new Date(),
  opts?: { trigger?: TickTrigger },
): Promise<{
  ran: Array<{ jobKey: string; runId: string; status: string }>;
  skipped: string[];
  leaseHeld?: boolean;
  workerId?: string;
  trigger: TickTrigger;
}> {
  const trigger: TickTrigger = opts?.trigger ?? "manual_api";
  lastTickTrigger = trigger;
  const { enforceAutonomyWindow } = await import("./autonomy-window.js");
  await enforceAutonomyWindow(now);
  const kill = await getKillSwitch();
  if (kill.enabled) {
    lastTickAt = now;
    lastTickSummary = { ran: 0, skipped: 1, leaseHeld: false, trigger };
    return { ran: [], skipped: ["kill_switch"], leaseHeld: false, workerId: getWorkerId(), trigger };
  }
  if (ticking) {
    return { ran: [], skipped: ["already_ticking"], leaseHeld: false, workerId: getWorkerId(), trigger };
  }

  const lease = await acquireLease(SCHEDULER_LEASE_KEY, SCHEDULER_TICK_LEASE_MS, {
    phase: "5D",
    at: now.toISOString(),
    trigger,
  });
  if (!lease.acquired) {
    lastTickAt = now;
    lastTickSummary = { ran: 0, skipped: 1, leaseHeld: false, trigger };
    return {
      ran: [],
      skipped: [`lease_held_by:${lease.holderId}`],
      leaseHeld: false,
      workerId: getWorkerId(),
      trigger,
    };
  }

  ticking = true;
  const ran: Array<{ jobKey: string; runId: string; status: string }> = [];
  const skipped: string[] = [];
  const prisma = getPrisma();

  try {
    await heartbeatWorkerInstance().catch(() => undefined);
    await ensureDefaultAutonomyJobs();
    await ensureDefaultGoalsAndPolicies();

    const handlerOrder: Record<string, number> = {
      agent_pass: 0,
      ceo_cycle: 1,
      reconciliation: 2,
      growth_cycle: 3,
    };
    const jobs = (await prisma.scheduledJob.findMany({ where: { enabled: true } })).sort(
      (a, b) => (handlerOrder[a.handler] ?? 9) - (handlerOrder[b.handler] ?? 9),
    );
    for (const job of jobs) {
      // Uzun döngülerde lease yenile
      const stillMine = await renewLease(SCHEDULER_LEASE_KEY, SCHEDULER_TICK_LEASE_MS);
      if (!stillMine) {
        skipped.push(`${job.jobKey}:lease_lost`);
        break;
      }

      if (!isDue(job.lastFinishedAt, job.cronExpr, now)) {
        skipped.push(job.jobKey);
        continue;
      }
      const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(Math.floor(now.getUTCMinutes() / intervalMinutesFromCron(job.cronExpr)) * intervalMinutesFromCron(job.cronExpr)).padStart(2, "0")}`;
      const idempotencyKey = `${job.jobKey}:${bucket}`;
      const existing = await prisma.scheduledJobRun.findUnique({ where: { idempotencyKey } });
      if (existing) {
        skipped.push(`${job.jobKey}:idempotent`);
        continue;
      }

      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { lastStartedAt: now, lastStatus: "running", updatedAt: now },
      });

      let run: { id: string };
      try {
        run = await prisma.scheduledJobRun.create({
          data: {
            jobId: job.id,
            idempotencyKey,
            status: "running",
            startedAt: now,
          },
        });
      } catch {
        // Unique race: diğer worker aynı bucket'ı aldı
        skipped.push(`${job.jobKey}:idempotent_race`);
        continue;
      }

      try {
        const result = await executeHandler(job.handler);
        const finished = new Date();
        const rec = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
        const skipHint =
          typeof rec.skippedReason === "string"
            ? rec.skippedReason
            : typeof rec.skipped === "string"
              ? rec.skipped
              : null;
        const realAi = rec.realAiExecution === true;
        const idle = Boolean(skipHint);
        const status = idle ? "skipped" : "succeeded";
        const message = idle
          ? `skipped:${skipHint}`
          : realAi
            ? "OK realAiExecution=true"
            : "OK realAiExecution=false";
        await prisma.scheduledJobRun.update({
          where: { id: run.id },
          data: {
            status,
            finishedAt: finished,
            message,
            resultJson: JSON.stringify(result).slice(0, 24_000),
          },
        });
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { lastFinishedAt: finished, lastStatus: status, updatedAt: finished },
        });
        ran.push({ jobKey: job.jobKey, runId: run.id, status });
      } catch (error) {
        const finished = new Date();
        const msg = error instanceof Error ? error.message : String(error);
        await prisma.scheduledJobRun.update({
          where: { id: run.id },
          data: { status: "failed", finishedAt: finished, message: msg.slice(0, 1000) },
        });
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { lastFinishedAt: finished, lastStatus: "failed", updatedAt: finished },
        });
        ran.push({ jobKey: job.jobKey, runId: run.id, status: "failed" });
      }
    }

    const { closeSettledCeoParents } = await import("./parent-task-lifecycle.js");
    await closeSettledCeoParents().catch(() => 0);

    await writeAudit({
      category: "autonomy",
      action: "scheduler.tick",
      actorKind: "system",
      summary: `Scheduler tick: ${ran.length} çalıştı, ${skipped.length} atlandı.`,
      metadata: { ran, skipped, workerId: getWorkerId(), lease: true, trigger },
    });
  } finally {
    ticking = false;
    lastTickAt = now;
    lastTickSummary = { ran: ran.length, skipped: skipped.length, leaseHeld: true, trigger };
    await releaseLease(SCHEDULER_LEASE_KEY).catch(() => undefined);
  }

  return { ran, skipped, leaseHeld: true, workerId: getWorkerId(), trigger };
}

export function getSchedulerRuntimeStatus() {
  return {
    timerActive: timer !== null,
    ticking,
    lastTickAt: lastTickAt?.toISOString() ?? null,
    lastTickTrigger,
    lastTickSummary,
    workerId: getWorkerId(),
    leaseKey: SCHEDULER_LEASE_KEY,
    processRole: timer !== null ? ("timer_owner" as const) : ("http_only_or_script" as const),
  };
}

export function startAutonomyScheduler(intervalMs = 60_000): void {
  if (timer) return;
  void ensureDefaultAutonomyJobs().catch(() => undefined);
  void ensureDefaultGoalsAndPolicies().catch(() => undefined);
  void heartbeatWorkerInstance().catch(() => undefined);
  heartbeatTimer = setInterval(() => {
    void heartbeatWorkerInstance().catch(() => undefined);
  }, 20_000);
  timer = setInterval(() => {
    void schedulerTick(new Date(), { trigger: "timer" }).catch(() => undefined);
  }, intervalMs);
  setTimeout(() => {
    void schedulerTick(new Date(), { trigger: "timer" }).catch(() => undefined);
  }, 3_000);
}

export function stopAutonomyScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}
