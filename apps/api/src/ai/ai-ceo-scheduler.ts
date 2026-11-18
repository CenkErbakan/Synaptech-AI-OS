import { randomUUID, createHash } from "node:crypto";
import { CeoPlanSchema, type CeoPlan } from "@synaptech/shared";

import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "../engines/audit.js";
import { getKillSwitch } from "../engines/kill-switch.js";
import { killSwitchActive, integrationUnavailable } from "../lib/errors.js";
import { getEnv } from "../lib/env.js";
import { buildLocalCeoSafeContext } from "./local-ceo-context.js";
import {
  acquireLocalLlmCallLease,
  assertSchedulerAiCeoDailyBudget,
  releaseLocalLlmCallLease,
} from "./llm-call-guard.js";
import { buildQuotaAuditMeta } from "./llm-quota.js";
import { isRealAiCompletion } from "./model-provider.js";
import { normalizeLocalCeoPlanJson } from "./providers/local-provider.js";
import { getModelProvider, requireLocalModelProvider } from "./providers/registry.js";
import { normalizeTitleKey, validateAndGroundPlanTasks } from "./plan-grounding.js";

export const AI_CEO_SCHEDULER_ORIGIN_PREFIX = "scheduler-ai-ceo:";

export type ScheduledAiCeoResult = {
  mode: "off" | "mock" | "local" | "deterministic_fallback";
  planner: "deterministic" | "mock_llm" | "local_llm";
  realAiExecution: boolean;
  skippedReason?: string;
  parentTaskId: string | null;
  childTaskIds: string[];
  messageIds: string[];
  plan: CeoPlan | null;
  modelId: string | null;
  durationMs: number | null;
  jsonValid: boolean | null;
  grounding: {
    accepted: number;
    unverified: number;
    rejected: number;
  } | null;
  archiveCheck: { ok: boolean; activeCount: number; archivedCount: number };
  cloudStarted: false;
};

async function verifyTaskBoardArchiveHealth() {
  const prisma = getPrisma();
  const [activeCount, archivedCount] = await Promise.all([
    prisma.task.count({ where: { archivedAt: null } }),
    prisma.task.count({ where: { archivedAt: { not: null } } }),
  ]);
  // Arşiv alanı kullanılabilir; panoda filtre archivedAt IS NULL beklenir
  return { ok: true, activeCount, archivedCount };
}

async function findDuplicateOpenTask(_projectId: string, title: string) {
  const prisma = getPrisma();
  const key = normalizeTitleKey(title);
  const { epochCreatedAtFilter } = await import("../engines/operation-epoch.js");
  const epochFilter = await epochCreatedAtFilter("current");
  const open = await prisma.task.findMany({
    where: {
      parentTaskId: { not: null },
      origin: { startsWith: AI_CEO_SCHEDULER_ORIGIN_PREFIX },
      ...epochFilter,
    },
    select: { id: true, title: true, status: true, archivedAt: true },
    take: 400,
  });
  return open.find((t) => normalizeTitleKey(t.title) === key) ?? null;
}

/**
 * Zamanlanmış AI CEO değerlendirmesi.
 * SCHEDULER_AI_CEO_MODE=off iken çağrılmaz (scheduler deterministik kalır).
 * local: bağlantı yoksa mock'a düşmez.
 * Görevleri MSSQL'e yazar; Cloud Agent başlatmaz; alt görevleri tamamlanmış saymaz.
 */
export async function runScheduledAiCeoCycle(input?: {
  idempotencySuffix?: string;
  allowWhenModeOff?: boolean;
}): Promise<ScheduledAiCeoResult> {
  const env = getEnv();
  const mode = env.SCHEDULER_AI_CEO_MODE;
  const archiveCheck = await verifyTaskBoardArchiveHealth();

  if (mode === "off" && !input?.allowWhenModeOff) {
    return {
      mode: "off",
      planner: "deterministic",
      realAiExecution: false,
      skippedReason: "scheduler_ai_ceo_mode_off",
      parentTaskId: null,
      childTaskIds: [],
      messageIds: [],
      plan: null,
      modelId: null,
      durationMs: null,
      jsonValid: null,
      grounding: null,
      archiveCheck,
      cloudStarted: false,
    };
  }

  if (mode === "local") {
    const { enforceAutonomyWindow } = await import("../engines/autonomy-window.js");
    const gate = await enforceAutonomyWindow();
    const { readOwnerGrants } = await import("../engines/owner-grants.js");
    const grants = await readOwnerGrants();
    if (!gate.active && !grants.permanentLocalAutonomy) {
      return {
        mode,
        planner: "local_llm",
        realAiExecution: false,
        skippedReason: gate.reason,
        parentTaskId: null,
        childTaskIds: [],
        messageIds: [],
        plan: null,
        modelId: null,
        durationMs: null,
        jsonValid: null,
        grounding: null,
        archiveCheck,
        cloudStarted: false,
      };
    }
  }

  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: zamanlanmış AI CEO yok.");

  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    throw integrationUnavailable("Scheduler AI CEO reddedildi: Cloud live açık olmamalı.");
  }

  const { evaluateScheduledCeoIdleSkip } = await import("../engines/local-ops-policy.js");
  const idle = await evaluateScheduledCeoIdleSkip();
  if (idle.skip) {
    return {
      mode,
      planner: mode === "local" ? "local_llm" : "mock_llm",
      realAiExecution: false,
      skippedReason: idle.reason,
      parentTaskId: null,
      childTaskIds: [],
      messageIds: [],
      plan: null,
      modelId: null,
      durationMs: null,
      jsonValid: null,
      grounding: null,
      archiveCheck,
      cloudStarted: false,
    };
  }

  const budget = await assertSchedulerAiCeoDailyBudget();
  if (!budget.ok) {
    return {
      mode,
      planner: mode === "local" ? "local_llm" : "mock_llm",
      realAiExecution: false,
      skippedReason: `${budget.reason};nextEligibleAt=${budget.nextEligibleAt ?? ""}`,
      parentTaskId: null,
      childTaskIds: [],
      messageIds: [],
      plan: null,
      modelId: null,
      durationMs: null,
      jsonValid: null,
      grounding: null,
      archiveCheck,
      cloudStarted: false,
    };
  }

  const lease = await acquireLocalLlmCallLease(180_000, "scheduler-ai-ceo");
  if (!lease.acquired) {
    return {
      mode,
      planner: mode === "local" ? "local_llm" : "mock_llm",
      realAiExecution: false,
      skippedReason: `llm_lease_held:${lease.reason ?? "held"}`,
      parentTaskId: null,
      childTaskIds: [],
      messageIds: [],
      plan: null,
      modelId: null,
      durationMs: null,
      jsonValid: null,
      grounding: null,
      archiveCheck,
      cloudStarted: false,
    };
  }

  const prisma = getPrisma();
  const dayKey = new Date().toISOString().slice(0, 10);
  const suffix = input?.idempotencySuffix ?? dayKey;
  const { readOperationEpoch } = await import("../engines/operation-epoch.js");
  const epoch = await readOperationEpoch();
  const epochPart = epoch?.id ?? "noepoch";
  const cycleOrigin = `${AI_CEO_SCHEDULER_ORIGIN_PREFIX}${epochPart}:${suffix}`;

  try {
    // Aynı gün/idempotency için ikinci model çağrısını engelle
    const existingParent = await prisma.task.findFirst({
      where: {
        origin: cycleOrigin,
        parentTaskId: null,
        archivedAt: null,
      },
    });
    if (existingParent) {
      return {
        mode,
        planner: mode === "local" ? "local_llm" : "mock_llm",
        realAiExecution: false,
        skippedReason: "idempotent_cycle_exists",
        parentTaskId: existingParent.id,
        childTaskIds: [],
        messageIds: [],
        plan: null,
        modelId: existingParent.model,
        durationMs: null,
        jsonValid: null,
        grounding: null,
        archiveCheck,
        cloudStarted: false,
      };
    }

    let provider;
    if (mode === "local") {
      try {
        provider = await requireLocalModelProvider();
        const probe = await provider.probe();
        if (!probe.ok) {
          const { enqueueDeferredLlm } = await import("../engines/deferred-llm-queue.js");
          await enqueueDeferredLlm({
            id: cycleOrigin,
            kind: "ceo_cycle",
            reason: probe.message.slice(0, 200),
          });
          return {
            mode,
            planner: "local_llm",
            realAiExecution: false,
            skippedReason: "local_llm_deferred_pc_offline",
            parentTaskId: null,
            childTaskIds: [],
            messageIds: [],
            plan: null,
            modelId: null,
            durationMs: null,
            jsonValid: null,
            grounding: null,
            archiveCheck,
            cloudStarted: false,
          };
        }
      } catch (error) {
        const { enqueueDeferredLlm } = await import("../engines/deferred-llm-queue.js");
        const msg = error instanceof Error ? error.message : "local_llm_unavailable";
        await enqueueDeferredLlm({ id: cycleOrigin, kind: "ceo_cycle", reason: msg.slice(0, 200) });
        return {
          mode,
          planner: "local_llm",
          realAiExecution: false,
          skippedReason: "local_llm_deferred_pc_offline",
          parentTaskId: null,
          childTaskIds: [],
          messageIds: [],
          plan: null,
          modelId: null,
          durationMs: null,
          jsonValid: null,
          grounding: null,
          archiveCheck,
          cloudStarted: false,
        };
      }
    } else {
      provider = getModelProvider();
    }

    const { setCeoEventPending } = await import("../engines/deferred-llm-queue.js");
    await setCeoEventPending(false);

    const context = await buildLocalCeoSafeContext();
    const started = Date.now();
    const quotaCallId = randomUUID();
    const completion = await provider.generateCeoPlan({
      goals: context.goals.map((g) => ({
        goalKey: g.goalKey,
        projectSlug: g.projectSlug,
        title: g.title,
        dataSource: g.dataSource,
      })),
      opportunities: context.opportunities
        .filter((o) => o.status === "open")
        .slice(0, 8)
        .map((o) => ({
          id: o.id,
          title: o.title,
          projectSlug: o.projectSlug,
          evidenceRef: o.evidenceRef,
        })),
      openTaskCount: context.openTasks.length,
      instruction: [
        "Zamanlanmış AI CEO değerlendirmesi.",
        `cycle=${suffix}`,
        `recentAgentResults=${context.recentAgentResults.length}`,
        context.recentAgentResults
          .slice(0, 8)
          .map((r) => `${r.from}->${r.to}:${r.summary}`)
          .join(" | ")
          .slice(0, 1200),
        "Aynı veya başarısız görev başlıklarını tekrar üretme; ajan sonuçlarını önceliklendir.",
        `mevcutEpochBasliklar=${context.epochChildTitles
          .map((t) => `${t.projectSlug}:${t.assigneeId}:${t.status}:${t.title}`)
          .join(" | ")
          .slice(0, 1600)}`,
        "Dört proje değerlendir: synaptech-ai-os, synaptech, subify, marivo. Hedef ve açık görevlere bak; tek projeye saplanma.",
        "growth-lead yalnızca dış müşteri/lead/SEO; yazılım borcunu cto/security/developer'a ver.",
        "security güvenlik/config; cto yapı/repo_read. En fazla 4 görev, mümkünse farklı proje.",
        "Her görevde evidenceHint: mssql:CompanyGoal | mssql:Opportunity | mssql:Task | mssql:Project | goal:<key> veya gerçek UUID.",
        "Onay/kill switch/Cloud/bütçe/git_push/müşteri ileti yok.",
      ].join(" "),
    });

    let plan: CeoPlan;
    try {
      const raw = completion.parsedPlan ?? JSON.parse(completion.content);
      plan = CeoPlanSchema.parse(normalizeLocalCeoPlanJson(raw));
    } catch {
      const invokedReal = isRealAiCompletion(completion);
      await writeAudit({
        category: "autonomy",
        action: "ai.scheduler_ceo_cycle",
        actorKind: "system",
        actorAgent: "ceo",
        summary: "Scheduler AI CEO: JSON şema doğrulaması başarısız (sağlayıcı çağrıldı).",
        metadata: buildQuotaAuditMeta({
          quotaCallId,
          quotaKind: "scheduler_ceo",
          realAiExecution: invokedReal,
          providerInvoked: true,
          mode,
          extra: { jsonValid: false, modelId: completion.modelId },
        }),
      });
      return {
        mode,
        planner: mode === "local" ? "local_llm" : "mock_llm",
        realAiExecution: false,
        skippedReason: "json_schema_invalid",
        parentTaskId: null,
        childTaskIds: [],
        messageIds: [],
        plan: null,
        modelId: completion.modelId,
        durationMs: Date.now() - started,
        jsonValid: false,
        grounding: null,
        archiveCheck,
        cloudStarted: false,
      };
    }

    const durationMs = Date.now() - started;
    const realAi = mode === "local" && isRealAiCompletion(completion);
    if (mode === "local" && !realAi) {
      throw integrationUnavailable("local modda gerçek AI yanıtı yok; mock başarı sayılmadı.");
    }

    const grounding = await validateAndGroundPlanTasks(plan);
    const persistable = [...grounding.accepted, ...grounding.unverified];

    const osProject =
      (await prisma.project.findUnique({ where: { slug: "synaptech-ai-os" } })) ??
      (await prisma.project.findFirst());
    if (!osProject) throw new Error("project_missing");

    const parentId = randomUUID();
    const contentSha = createHash("sha256").update(completion.content, "utf8").digest("hex");

    await prisma.task.create({
      data: {
        id: parentId,
        source: "real",
        title: `AI CEO plan (${mode}): ${plan.summary}`.slice(0, 140),
        description: [
          `planner=${mode === "local" ? "local_llm" : "mock_llm"}`,
          `realAiExecution=${realAi}`,
          `model=${completion.modelId}`,
          `contentSha256=${contentSha}`,
          `jsonValid=true`,
          `durationMs=${durationMs}`,
          `archiveActive=${archiveCheck.activeCount}`,
          `archiveArchived=${archiveCheck.archivedCount}`,
          plan.summary,
          `risks=${plan.risks.join(" | ")}`,
        ].join("\n"),
        projectId: osProject.id,
        assigneeId: "ceo",
        priority: "high",
        status: "planned",
        dispatchState: "ready",
        executionPolicy: "AUTO",
        origin: cycleOrigin,
        parentTaskId: null,
        workflowPhase: "ready",
        executionKind: realAi ? "real_ai_pending" : "deterministic",
        model: completion.modelId,
        acceptanceCriteria:
          "Owner incelemesi; alt görevler otomatik tamamlanmış sayılmaz; Cloud başlatılmaz.",
        idempotencyKey: `scheduler-ai-ceo-parent:${epochPart}:${suffix}`,
        blockedReason: null,
      },
    });

    const childTaskIds: string[] = [];
    const messageIds: string[] = [];

    for (const item of persistable) {
      const project = await prisma.project.findUnique({ where: { slug: item.task.projectSlug } });
      if (!project) continue;

      const dup = await findDuplicateOpenTask(project.id, item.task.title);
      if (dup) continue;

      const childId = randomUUID();
      const validationPayload = {
        verified: item.verified,
        reasons: item.reasons,
        evidenceResolved: item.evidenceResolved,
        validatedAt: new Date().toISOString(),
        sourceModel: completion.modelId,
        realAiExecution: realAi,
      };

      await prisma.task.create({
        data: {
          id: childId,
          source: "real",
          title: item.task.title.slice(0, 140),
          description: [
            item.task.description,
            `validation=${JSON.stringify(validationPayload)}`,
            item.verified ? "statusHint=verified" : "statusHint=unverified",
          ].join("\n"),
          projectId: project.id,
          assigneeId: item.task.assigneeId,
          priority: item.task.priority,
          status: "planned",
          dispatchState: "ready",
          executionPolicy: "AUTO",
          origin: cycleOrigin,
          parentTaskId: parentId,
          workflowPhase: "ready",
          executionKind: realAi ? "real_ai_pending" : "deterministic",
          model: completion.modelId,
          acceptanceCriteria: item.task.acceptanceCriteria,
          executionResult: JSON.stringify(validationPayload),
          idempotencyKey: `scheduler-ai-ceo-child:${epochPart}:${suffix}:${normalizeTitleKey(item.task.title).slice(0, 60)}`,
          blockedReason: item.verified ? null : "unverified_evidence",
        },
      });
      childTaskIds.push(childId);

      const msg = await prisma.agentMessage.create({
        data: {
          id: randomUUID(),
          fromAgentId: "ceo",
          toAgentId: item.task.assigneeId,
          taskId: childId,
          parentTaskId: parentId,
          kind: "handoff",
          summary: `AI CEO görev devri: ${item.task.title}`.slice(0, 240),
          evidenceRef: item.evidenceResolved,
          payloadJson: JSON.stringify({
            realAiExecution: realAi,
            verified: item.verified,
            modelId: completion.modelId,
            cloudStarted: false,
          }),
        },
      });
      messageIds.push(msg.id);
    }

    await writeAudit({
      category: "autonomy",
      action: "ai.scheduler_ceo_cycle",
      actorKind: "system",
      actorAgent: "ceo",
      targetType: "task",
      targetId: parentId,
      summary: realAi
        ? "Zamanlanmış yerel AI CEO planı doğrulandı ve görevler yazıldı."
        : "Zamanlanmış mock AI CEO planı (gerçek AI değil) — görevler yazıldı.",
      metadata: buildQuotaAuditMeta({
        quotaCallId,
        quotaKind: "scheduler_ceo",
        realAiExecution: realAi,
        providerInvoked: true,
        mode,
        extra: {
          modelId: completion.modelId,
          durationMs,
          jsonValid: true,
          contentSha256: contentSha,
          grounding: {
            accepted: grounding.accepted.length,
            unverified: grounding.unverified.length,
            rejected: grounding.rejected.length,
          },
          childCount: childTaskIds.length,
          cloudStarted: false,
          requiresOwnerApproval: true,
        },
      }),
    });

    return {
      mode,
      planner: mode === "local" ? "local_llm" : "mock_llm",
      realAiExecution: realAi,
      parentTaskId: parentId,
      childTaskIds,
      messageIds,
      plan,
      modelId: completion.modelId,
      durationMs,
      jsonValid: true,
      grounding: {
        accepted: grounding.accepted.length,
        unverified: grounding.unverified.length,
        rejected: grounding.rejected.length,
      },
      archiveCheck,
      cloudStarted: false,
    };
  } finally {
    await releaseLocalLlmCallLease();
  }
}
