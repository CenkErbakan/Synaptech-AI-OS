import { getPrisma } from "../db/prisma.js";
import { killSwitchActive } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { startSoftwareDeliveryChain } from "./coordination-engine.js";
import { getKillSwitch } from "./kill-switch.js";
import { scanOpportunities } from "./opportunity-engine.js";

export interface CeoCycleResult {
  planner: "deterministic";
  opportunitiesCreated: number;
  parentTaskId: string | null;
  subtaskId: string | null;
  chainId: string | null;
  opportunityId: string | null;
  messageId: string | null;
  skippedReason?: string;
}

/**
 * Deterministik CEO döngüsü — gerçek LLM değildir.
 * Fırsat tarar ve Faz 5B yazılım teslim zincirini başlatır.
 */
export async function runDeterministicCeoCycle(input?: {
  idempotencySuffix?: string;
}): Promise<CeoCycleResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: otonom CEO döngüsü yok.");

  const prisma = getPrisma();
  const scan = await scanOpportunities();

  const opportunity = await prisma.opportunity.findFirst({
    where: { status: "open", verified: true },
    orderBy: { createdAt: "desc" },
  });

  if (!opportunity) {
    return {
      planner: "deterministic",
      opportunitiesCreated: scan.created.length,
      parentTaskId: null,
      subtaskId: null,
      chainId: null,
      opportunityId: null,
      messageId: null,
      skippedReason: "verified_opportunity_yok",
    };
  }

  const project = await prisma.project.findUnique({ where: { slug: opportunity.projectSlug } });
  if (!project) {
    return {
      planner: "deterministic",
      opportunitiesCreated: scan.created.length,
      parentTaskId: null,
      subtaskId: null,
      chainId: null,
      opportunityId: opportunity.id,
      messageId: null,
      skippedReason: "project_not_found",
    };
  }

  const suffix = input?.idempotencySuffix ?? new Date().toISOString().slice(0, 13);
  const parentKey = `auto-ceo-chain:${opportunity.dedupeHash}:${suffix}`;

  const chain = await startSoftwareDeliveryChain({
    projectSlug: opportunity.projectSlug,
    title: `CEO plan: ${opportunity.title}`.slice(0, 140),
    description: [
      "Otonom CEO → yazılım teslim zinciri (deterministik; LLM değil).",
      opportunity.description,
      `Fırsat: ${opportunity.id}`,
      `Kanıt: ${opportunity.evidenceRef ?? "yok"}`,
    ].join("\n"),
    opportunityId: opportunity.id,
    origin: `opportunity:${opportunity.id}`,
    idempotencyKey: parentKey,
    executionKind: "deterministic",
  });

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: { status: "accepted", updatedAt: new Date() },
  });

  const firstStep = chain.steps.find((s) => s.step === "ceo_plan") ?? chain.steps[0] ?? null;
  const handoff = await prisma.agentMessage.findFirst({
    where: { chainId: chain.chainId, kind: "handoff" },
    orderBy: { createdAt: "desc" },
  });

  await writeAudit({
    category: "autonomy",
    action: "ceo.cycle_completed",
    actorKind: "agent",
    actorAgent: "ceo",
    targetType: "task",
    targetId: chain.parentTaskId,
    summary: "Deterministik CEO döngüsü: fırsat → yazılım teslim zinciri.",
    metadata: {
      planner: "deterministic",
      opportunityId: opportunity.id,
      parentTaskId: chain.parentTaskId,
      chainId: chain.chainId,
      realAiExecution: false,
    },
  });

  return {
    planner: "deterministic",
    opportunitiesCreated: scan.created.length,
    parentTaskId: chain.parentTaskId,
    subtaskId: firstStep?.id ?? null,
    chainId: chain.chainId,
    opportunityId: opportunity.id,
    messageId: handoff?.id ?? null,
  };
}
