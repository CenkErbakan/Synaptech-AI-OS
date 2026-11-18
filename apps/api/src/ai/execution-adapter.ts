import { CeoPlanSchema, type AgentEvidence, type CeoPlan } from "@synaptech/shared";

import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "../engines/audit.js";
import { startSoftwareDeliveryChain, type ExecutionKind } from "../engines/coordination-engine.js";
import { getKillSwitch } from "../engines/kill-switch.js";
import { killSwitchActive } from "../lib/errors.js";
import { assertCloudCreateAllowed, evaluateCloudBudgetGate } from "./budget-gate.js";
import { evidenceLine, isRealAiCompletion } from "./model-provider.js";
import { resolveActiveModelProvider } from "./providers/registry.js";

export type RunChannel = "deterministic" | "mock_llm" | "local_llm" | "cloud_coding";

export interface AiPipelineResult {
  channel: RunChannel;
  realAiExecution: boolean;
  providerMode: string;
  plan: CeoPlan | null;
  chainId: string | null;
  parentTaskId: string | null;
  evidence: AgentEvidence[];
  blockedReason?: string;
  cloudGate: ReturnType<typeof evaluateCloudBudgetGate>;
}

function mapProviderToExecutionKind(channel: RunChannel): ExecutionKind {
  if (channel === "mock_llm") return "real_ai_pending"; // şema alanı dar; metadata'da net
  if (channel === "local_llm") return "real_ai_pending";
  return "deterministic";
}

/**
 * Scheduler → ModelProvider → CEO planı → schema → zincir.
 * Mock ile güvenli test; Cloud create budget gate olmadan YOK.
 */
export async function runAiCeoPipeline(input?: {
  forceChannel?: RunChannel;
  opportunityId?: string;
  idempotencySuffix?: string;
}): Promise<AiPipelineResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: AI pipeline yok.");

  const cloudGate = evaluateCloudBudgetGate();
  const resolved = await resolveActiveModelProvider();
  const prisma = getPrisma();

  // local seçili veya local_llm zorlandıysa bağlantı yoksa mock üretme
  if (
    (input?.forceChannel === "local_llm" || resolved.mode === "local_unavailable" || resolved.localUnavailable) &&
    !resolved.realAiAvailable
  ) {
    const { integrationUnavailable } = await import("../lib/errors.js");
    throw integrationUnavailable(
      `Yerel LLM bağlantı hatası; mock yanıt üretilmedi. ${resolved.note}`,
    );
  }

  const channel: RunChannel =
    input?.forceChannel ??
    (resolved.realAiAvailable
      ? "local_llm"
      : resolved.provider.id === "mock"
        ? "mock_llm"
        : "deterministic");

  const goals = await prisma.companyGoal.findMany({ where: { status: "active" }, take: 20 });
  const opportunities = await prisma.opportunity.findMany({
    where: input?.opportunityId
      ? { id: input.opportunityId }
      : { status: "open", verified: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const openTaskCount = await prisma.task.count({
    where: { source: "real", status: { in: ["planned", "in_progress", "testing", "in_review"] } },
  });

  if (!opportunities.length && channel !== "deterministic") {
    return {
      channel,
      realAiExecution: false,
      providerMode: resolved.mode,
      plan: null,
      chainId: null,
      parentTaskId: null,
      evidence: [],
      blockedReason: "no_verified_opportunity",
      cloudGate,
    };
  }

  const completion = await resolved.provider.generateCeoPlan({
    goals: goals.map((g) => ({
      goalKey: g.goalKey,
      projectSlug: g.projectSlug,
      title: g.title,
      dataSource: g.dataSource,
    })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      projectSlug: o.projectSlug,
      evidenceRef: o.evidenceRef,
    })),
    openTaskCount,
  });

  const plan = completion.parsedPlan
    ? CeoPlanSchema.parse(completion.parsedPlan)
    : CeoPlanSchema.parse(JSON.parse(completion.content));

  const realAi = isRealAiCompletion(completion) && channel === "local_llm";
  // Mock/deterministic asla "gerçek AI tamamladı" sayılmaz
  if (!realAi && channel === "local_llm") {
    return {
      channel: "mock_llm",
      realAiExecution: false,
      providerMode: resolved.mode,
      plan,
      chainId: null,
      parentTaskId: null,
      evidence: completion.evidence,
      blockedReason: "local_marked_unreal",
      cloudGate,
    };
  }

  const opp = opportunities[0];
  if (!opp) {
    return {
      channel,
      realAiExecution: realAi,
      providerMode: resolved.mode,
      plan,
      chainId: null,
      parentTaskId: null,
      evidence: completion.evidence,
      blockedReason: "no_opportunity_for_chain",
      cloudGate,
    };
  }

  // Mükerrer zincir: aynı fırsat için açık parent varsa yeni başlatma
  const existing = await prisma.task.findFirst({
    where: {
      origin: `opportunity:${opp.id}`,
      parentTaskId: null,
      archivedAt: null,
      status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
    },
  });
  if (existing) {
    return {
      channel,
      realAiExecution: realAi,
      providerMode: resolved.mode,
      plan,
      chainId: existing.chainId,
      parentTaskId: existing.id,
      evidence: completion.evidence,
      blockedReason: "duplicate_chain_prevented",
      cloudGate,
    };
  }

  const suffix = input?.idempotencySuffix ?? `ai-${channel}-${new Date().toISOString().slice(0, 13)}`;
  const firstTask = plan.tasks[0];
  if (!firstTask) {
    return {
      channel,
      realAiExecution: realAi,
      providerMode: resolved.mode,
      plan,
      chainId: null,
      parentTaskId: null,
      evidence: completion.evidence,
      blockedReason: "empty_plan_tasks",
      cloudGate,
    };
  }
  const chain = await startSoftwareDeliveryChain({
    projectSlug: firstTask.projectSlug,
    title: `AI CEO plan: ${plan.summary}`.slice(0, 140),
    description: [
      `channel=${channel}`,
      `realAiExecution=${realAi}`,
      `provider=${completion.providerId}/${completion.modelId}`,
      plan.summary,
      `evidence=${evidenceLine(completion.evidence)}`,
      ...plan.tasks.map((t, i) => `${i + 1}. [${t.assigneeId}] ${t.title}`),
    ].join("\n"),
    opportunityId: opp.id,
    origin: `opportunity:${opp.id}`,
    idempotencyKey: `ai-ceo-pipeline:${opp.dedupeHash}:${suffix}`,
    executionKind: mapProviderToExecutionKind(channel),
  });

  await prisma.opportunity.update({
    where: { id: opp.id },
    data: { status: "accepted", updatedAt: new Date() },
  });

  await writeAudit({
    category: "autonomy",
    action: "ai.ceo_pipeline",
    actorKind: "agent",
    actorAgent: "ceo",
    targetType: "task",
    targetId: chain.parentTaskId,
    summary: realAi
      ? "Yerel LLM CEO planı doğrulandı ve zincir açıldı."
      : "Mock/deterministik CEO pipeline — gerçek AI yürütmesi değil.",
    metadata: {
      channel,
      realAiExecution: realAi,
      provider: completion.providerId,
      modelId: completion.modelId,
      cloudAutoDispatchAllowed: cloudGate.cloudAutoDispatchAllowed,
      evidence: completion.evidence,
    },
  });

  return {
    channel,
    realAiExecution: realAi,
    providerMode: resolved.mode,
    plan,
    chainId: chain.chainId,
    parentTaskId: chain.parentTaskId,
    evidence: completion.evidence,
    cloudGate,
  };
}

/**
 * Kod adımı için Cloud coding executor kapısı.
 * ModelProvider değildir. Onaysız / limitsiz create engellenir.
 */
export function evaluateCodingCloudStart(input: {
  hasOwnerApproval: boolean;
  approvalType?: string;
}): { allowed: false; reason: string; realAiExecution: false } {
  const check = assertCloudCreateAllowed(input);
  return { allowed: false, reason: check.ok ? "unreachable" : check.reason, realAiExecution: false };
}

/** Growth/SEO/blog için AI entegrasyon noktası (publish/müşteri iletişimi yok). */
export async function prepareGrowthAiHook(kind: "seo" | "content" | "research"): Promise<{
  ready: boolean;
  realAiExecution: boolean;
  providerMode: string;
  note: string;
  silentMockFallback: false;
}> {
  const { getEnv } = await import("../lib/env.js");
  const env = getEnv();
  const resolved = await resolveActiveModelProvider();

  // local seçiliyse bağlantı yoksa ready=false — sessiz mock yok
  if (env.MODEL_PROVIDER === "local" && !resolved.realAiAvailable) {
    return {
      ready: false,
      realAiExecution: false,
      providerMode: resolved.mode,
      note: `growth_ai_hook:${kind} — yerel model erişilemez; mock'a düşülmedi. ${resolved.note}`,
      silentMockFallback: false,
    };
  }

  return {
    ready: resolved.mode !== "none",
    realAiExecution: resolved.realAiAvailable,
    providerMode: resolved.mode,
    note: `growth_ai_hook:${kind} — yayın/müşteri iletişimi yok; yalnızca plan/üretim noktası. ${resolved.note}`,
    silentMockFallback: false,
  };
}
