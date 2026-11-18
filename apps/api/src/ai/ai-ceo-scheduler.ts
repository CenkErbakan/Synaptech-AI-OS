import { randomUUID, createHash } from "node:crypto";
import { CeoPlanSchema, type CeoPlan } from "@synaptech/shared";

import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "../engines/audit.js";
import { getKillSwitch } from "../engines/kill-switch.js";
import { killSwitchActive, integrationUnavailable } from "../lib/errors.js";
import { getEnv } from "../lib/env.js";
import { buildLocalCeoSafeContext } from "./local-ceo-context.js";
import { clipIdempotencyKey } from "./ceo-plan-prompt.js";
import {
  evaluateCeoCircuit,
  resetCeoProviderCircuit,
  tripCeoProviderCircuit,
  readCeoProviderCircuit,
} from "./ceo-provider-circuit.js";
import {
  acquireLocalLlmCallLease,
  assertSchedulerAiCeoDailyBudget,
  LOCAL_LLM_LEASE_TTL_MS,
  releaseLocalLlmCallLease,
} from "./llm-call-guard.js";
import { buildQuotaAuditMeta } from "./llm-quota.js";
import { isRealAiCompletion } from "./model-provider.js";
import { normalizeLocalCeoPlanJson } from "./providers/local-provider.js";
import { getModelProvider, requireLocalModelProvider } from "./providers/registry.js";
import { normalizeTitleKey, validateAndGroundPlanTasks } from "./plan-grounding.js";
import { applyRoleGateToPlanTasks, pickDiversePersistable } from "./plan-role-gate.js";

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
  /** Owner kontrollü tek doğrulama — timer yolu kullanmaz. */
  ignoreCircuit?: boolean;
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

  if (!input?.ignoreCircuit) {
    const circuit = evaluateCeoCircuit(await readCeoProviderCircuit(), new Date());
    if (circuit.skip) {
      return {
        mode,
        planner: mode === "local" ? "local_llm" : "mock_llm",
        realAiExecution: false,
        skippedReason: circuit.reason,
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

  const { evaluateScheduledCeoIdleSkip } = await import("../engines/local-ops-policy.js");
  const idle = input?.idempotencySuffix
    ? { skip: false as const }
    : await evaluateScheduledCeoIdleSkip();
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

  const lease = await acquireLocalLlmCallLease(LOCAL_LLM_LEASE_TTL_MS, "scheduler-ai-ceo");
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
  const cycleId = input?.idempotencySuffix ?? randomUUID();
  const suffix = cycleId;
  const { readOperationEpoch } = await import("../engines/operation-epoch.js");
  const epoch = await readOperationEpoch();
  const epochPart = epoch?.id ?? "noepoch";
  const cycleOrigin = `${AI_CEO_SCHEDULER_ORIGIN_PREFIX}${epochPart}:cycle:${suffix}`;

  try {
    // Aynı cycleId ikinci kez LLM çağırmaz (test/manuel suffix). Timer yolu her seferinde yeni UUID.
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
    let completion;
    try {
      completion = await provider.generateCeoPlan({
        goals: context.goals.map((g) => ({
          goalKey: g.goalKey,
          projectSlug: g.projectSlug,
          title: g.title,
          dataSource: g.dataSource,
        })),
        opportunities: context.opportunities
          .filter((o) => o.status === "open")
          .slice(0, 6)
          .map((o) => ({
            id: o.id,
            title: o.title,
            projectSlug: o.projectSlug,
            evidenceRef: o.evidenceRef,
          })),
        openTaskCount: context.openTasks.length,
        instruction: [
          `cycle=${suffix}`,
          "Dört proje: synaptech-ai-os, synaptech, subify, marivo. Kanıtsız görev yok.",
          `open=${context.openTasks.length}`,
          context.recentAgentResults
            .slice(0, 6)
            .map((r) => `${r.from}:${r.summary}`)
            .join("|")
            .slice(0, 400),
          `epoch=${context.epochChildTitles
            .slice(0, 12)
            .map((t) => `${t.projectSlug}:${t.assigneeId}:${t.status}:${t.title}`)
            .join("|")
            .slice(0, 480)}`,
          "1-5 görev üret (8 zorunlu değil). Kısa acceptanceCriteria + evidenceHint.",
        ].join(" "),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (mode === "local") {
        await tripCeoProviderCircuit(msg.slice(0, 240));
      }
      await writeAudit({
        category: "autonomy",
        action: "ai.scheduler_ceo_cycle",
        actorKind: "system",
        actorAgent: "ceo",
        summary: "Scheduler AI CEO: sağlayıcı çağrısı başarısız (görev yazılmadı).",
        metadata: buildQuotaAuditMeta({
          quotaCallId,
          quotaKind: "scheduler_ceo",
          realAiExecution: false,
          providerInvoked: !msg.startsWith("local_llm_unavailable"),
          mode,
          extra: {
            jsonValid: false,
            childCount: 0,
            providerError: msg.slice(0, 200),
            timeout: msg.includes("local_llm_timeout") || /aborted/i.test(msg),
          },
        }),
      });
      return {
        mode,
        planner: mode === "local" ? "local_llm" : "mock_llm",
        realAiExecution: false,
        skippedReason: msg.includes("local_llm_timeout") ? "local_llm_timeout" : `provider_error:${msg.slice(0, 80)}`,
        parentTaskId: null,
        childTaskIds: [],
        messageIds: [],
        plan: null,
        modelId: null,
        durationMs: Date.now() - started,
        jsonValid: false,
        grounding: null,
        archiveCheck,
        cloudStarted: false,
      };
    }

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

    const gated = applyRoleGateToPlanTasks(plan.tasks);
    plan = { ...plan, tasks: gated.tasks };
    const grounding = await validateAndGroundPlanTasks(plan);
    const remainingSlots = Math.max(
      0,
      env.LOCAL_OPS_OPEN_TASK_CAP - context.openTasks.filter((t) => t.assigneeId !== "ceo").length,
    );
    const persistableRaw = [...grounding.accepted, ...grounding.unverified];
    const persistable =
      remainingSlots <= 0 ? [] : pickDiversePersistable(persistableRaw, Math.min(8, remainingSlots));

    if (persistable.length === 0) {
      await writeAudit({
        category: "autonomy",
        action: "ai.scheduler_ceo_cycle",
        actorKind: "system",
        actorAgent: "ceo",
        summary: "Scheduler AI CEO: uygulanabilir görev yazılmadı (kuyruk/grounding/çeşitlilik).",
        metadata: buildQuotaAuditMeta({
          quotaCallId,
          quotaKind: "scheduler_ceo",
          realAiExecution: realAi,
          providerInvoked: true,
          mode,
          extra: {
            jsonValid: true,
            childCount: 0,
            remainingSlots,
            grounding: {
              accepted: grounding.accepted.length,
              unverified: grounding.unverified.length,
              rejected: grounding.rejected.length,
            },
            roleGate: gated.redirects,
          },
        }),
      });
      return {
        mode,
        planner: mode === "local" ? "local_llm" : "mock_llm",
        realAiExecution: realAi,
        skippedReason: remainingSlots <= 0 ? "queue_cap_reached" : "empty_grounded_plan",
        parentTaskId: null,
        childTaskIds: [],
        messageIds: [],
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
    }

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
          `projectAllocation=${JSON.stringify(
            persistable.reduce<Record<string, number>>((acc, item) => {
              acc[item.task.projectSlug] = (acc[item.task.projectSlug] ?? 0) + 1;
              return acc;
            }, {}),
          )}`,
          gated.redirects.length
            ? `roleGate=${JSON.stringify(gated.redirects).slice(0, 800)}`
            : "roleGate=none",
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
        idempotencyKey: clipIdempotencyKey(`scheduler-ai-ceo-parent:${epochPart}:${suffix}`),
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
          idempotencyKey: clipIdempotencyKey(
            `sce:${epochPart}:${suffix}:${normalizeTitleKey(item.task.title)}`,
          ),
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

    if (mode === "local") {
      await resetCeoProviderCircuit();
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
          inputTokens: completion.usage?.inputTokens ?? null,
          outputTokens: completion.usage?.outputTokens ?? null,
          evidenceRefs: (completion.evidence ?? []).map((e) => e.ref).slice(0, 16),
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
