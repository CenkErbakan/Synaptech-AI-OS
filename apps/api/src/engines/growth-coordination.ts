import { randomUUID } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { killSwitchActive } from "../lib/errors.js";
import { createAdProposals } from "./ads-engine.js";
import { writeAudit } from "./audit.js";
import { createContentDraftsFromSeo } from "./content-engine.js";
import { completeChainStep, failChainStep, startChainStep } from "./coordination-engine.js";
import { runGrowthLeadResearch } from "./growth-engine.js";
import { getKillSwitch } from "./kill-switch.js";
import { runTechnicalSeoScan } from "./seo-engine.js";

/**
 * Büyüme zinciri adımları — software zincirinden ayrı chainStep isimleri.
 * coordination-engine CHAIN_STEPS sabit; bu motor kendi task setini üretir.
 */
export const GROWTH_STEPS = [
  "ceo_growth_brief",
  "growth_research",
  "seo_audit",
  "content_draft",
  "ads_proposal",
  "ceo_growth_close",
] as const;

export type GrowthStep = (typeof GROWTH_STEPS)[number];

const META: Record<
  GrowthStep,
  { order: number; agentId: string; title: string; acceptance: string }
> = {
  ceo_growth_brief: {
    order: 1,
    agentId: "ceo",
    title: "CEO büyüme brifi",
    acceptance: "Hedef segmentler ve kısıtlar yazılı; Growth Lead’e devredildi.",
  },
  growth_research: {
    order: 2,
    agentId: "growth-lead",
    title: "Growth Lead müşteri araştırması",
    acceptance: "GrowthScanRun + en az bir denenen kamu kaynağı; outreach yok.",
  },
  seo_audit: {
    order: 3,
    agentId: "seo-specialist",
    title: "SEO teknik tarama",
    acceptance: "Ölçülmüş SeoFinding kayıtları veya açık fetch hatası kanıtı.",
  },
  content_draft: {
    order: 4,
    agentId: "content-manager",
    title: "Content taslak üretimi",
    acceptance: "TR/EN ContentDraftRecord; template olarak işaretli; yayın yok.",
  },
  ads_proposal: {
    order: 5,
    agentId: "ads-manager",
    title: "Ads öneri taslağı",
    acceptance: "AdProposal draft; liveLaunch=false.",
  },
  ceo_growth_close: {
    order: 6,
    agentId: "ceo",
    title: "CEO büyüme kapanışı",
    acceptance: "Özet kaydı; eksikler CEO’ya raporlandı.",
  },
};

async function postMessage(input: {
  from: string;
  to: string;
  taskId?: string;
  parentTaskId: string;
  chainId: string;
  kind: string;
  summary: string;
  payload?: unknown;
}) {
  return getPrisma().agentMessage.create({
    data: {
      fromAgentId: input.from,
      toAgentId: input.to,
      taskId: input.taskId ?? null,
      parentTaskId: input.parentTaskId,
      chainId: input.chainId,
      kind: input.kind,
      summary: input.summary.slice(0, 1000),
      payloadJson: input.payload ? JSON.stringify(input.payload).slice(0, 8000) : null,
    },
  });
}

export async function startGrowthDeliveryChain(input: {
  idempotencyKey: string;
  title?: string;
}): Promise<{
  mode: "deterministic_growth_coordination";
  realAiExecution: false;
  chainId: string;
  parentTaskId: string;
  steps: Array<{ id: string; step: GrowthStep; agentId: string; workflowPhase: string }>;
}> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const prisma = getPrisma();
  const existing = await prisma.task.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing?.chainId) {
    const steps = await prisma.task.findMany({
      where: { chainId: existing.chainId, parentTaskId: existing.id },
      orderBy: { chainOrder: "asc" },
    });
    return {
      mode: "deterministic_growth_coordination",
      realAiExecution: false,
      chainId: existing.chainId,
      parentTaskId: existing.id,
      steps: steps.map((s) => ({
        id: s.id,
        step: s.chainStep as GrowthStep,
        agentId: s.assigneeId,
        workflowPhase: s.workflowPhase ?? "waiting_dependency",
      })),
    };
  }

  const project = await prisma.project.findUnique({ where: { slug: "synaptech" } });
  if (!project) throw new Error("project_synaptech_missing");

  const chainId = randomUUID();
  const parentId = randomUUID();
  const now = new Date();
  const title = (input.title ?? "Faz 5C büyüme döngüsü: lead + SEO + içerik + ads öneri").slice(0, 140);
  const stepIds = Object.fromEntries(GROWTH_STEPS.map((s) => [s, randomUUID()])) as Record<
    GrowthStep,
    string
  >;

  await prisma.$transaction(async (tx) => {
    await tx.task.create({
      data: {
        id: parentId,
        source: "real",
        title,
        description:
          "Büyüme koordinasyon zinciri (Faz 5C). Deterministik; gerçek AI yürütmesi değil. Otomatik müşteri ileti/yayın/reklam yok.",
        projectId: project.id,
        assigneeId: "ceo",
        priority: "medium",
        status: "in_progress",
        dispatchState: "not_applicable",
        executionPolicy: "AUTO",
        origin: "growth:faz5c",
        chainId,
        chainStep: "ceo_growth_brief",
        chainOrder: 0,
        workflowPhase: "running",
        executionKind: "deterministic",
        acceptanceCriteria: "Tüm büyüme adımları motor çıktısıyla kapanır.",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
    });

    let prev: string | null = null;
    for (const step of GROWTH_STEPS) {
      const meta = META[step];
      const id = stepIds[step];
      const first = step === "ceo_growth_brief";
      await tx.task.create({
        data: {
          id,
          source: "real",
          title: `${meta.title}: ${title}`.slice(0, 140),
          description: `Zincir=${step}; agent=${meta.agentId}; executionKind=deterministic`,
          projectId: project.id,
          assigneeId: meta.agentId,
          priority: "medium",
          status: first ? "planned" : "backlog",
          dispatchState: first ? "ready" : "not_applicable",
          executionPolicy: "AUTO",
          origin: "growth:faz5c",
          parentTaskId: parentId,
          chainId,
          chainStep: step,
          chainOrder: meta.order,
          dependsOnTaskId: prev,
          workflowPhase: first ? "ready" : "waiting_dependency",
          blockedReason: first ? null : `depends_on:${prev}`,
          acceptanceCriteria: meta.acceptance,
          executionKind: "deterministic",
          idempotencyKey: `${input.idempotencyKey}:${step}`,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.taskAssignment.create({
        data: { taskId: id, agentId: meta.agentId, note: `Faz 5C growth: ${step}` },
      });
      prev = id;
    }
  });

  await postMessage({
    from: "ceo",
    to: "growth-lead",
    taskId: stepIds.ceo_growth_brief,
    parentTaskId: parentId,
    chainId,
    kind: "handoff",
    summary: "CEO büyüme zincirini başlattı (deterministik).",
    payload: { realAiExecution: false, steps: GROWTH_STEPS },
  });

  await writeAudit({
    category: "growth",
    action: "growth.chain_started",
    actorKind: "agent",
    actorAgent: "ceo",
    targetType: "task",
    targetId: parentId,
    summary: "Büyüme zinciri başlatıldı.",
    metadata: { chainId, realAiExecution: false },
  });

  return {
    mode: "deterministic_growth_coordination",
    realAiExecution: false,
    chainId,
    parentTaskId: parentId,
    steps: GROWTH_STEPS.map((step) => ({
      id: stepIds[step],
      step,
      agentId: META[step].agentId,
      workflowPhase: step === "ceo_growth_brief" ? "ready" : "waiting_dependency",
    })),
  };
}

/**
 * Adımı gerçek motor çıktısı olmadan tamamlamaz.
 */
export async function executeGrowthStep(taskId: string): Promise<{
  ok: boolean;
  step?: string;
  engineResult?: unknown;
  reason?: string;
  unlockedTaskId?: string | null;
}> {
  const prisma = getPrisma();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task?.chainId || !task.chainStep || !task.parentTaskId) {
    return { ok: false, reason: "not_growth_step" };
  }
  const step = task.chainStep as GrowthStep;
  if (!(GROWTH_STEPS as readonly string[]).includes(step)) {
    return { ok: false, reason: "unknown_growth_step" };
  }

  const start = await startChainStep(taskId);
  if (!start.ok && start.reason !== "already_completed") {
    if (start.reason === "waiting_dependency" || start.reason === "dependency_not_completed") {
      return { ok: false, reason: start.reason, step };
    }
  }

  let engineResult: unknown;
  let resultText: string;

  try {
    if (step === "ceo_growth_brief") {
      engineResult = {
        segments: ["izmir-kobi-uretim", "kurumsal-web", "ozel-yazilim", "ai-entegrasyon"],
        constraints: ["no_outreach", "no_publish", "no_ads_live", "no_llm"],
      };
      resultText = "CEO brifi: segmentler ve güvenlik kısıtları kaydedildi.";
    } else if (step === "growth_research") {
      engineResult = await runGrowthLeadResearch({ chainId: task.chainId });
      resultText = JSON.stringify(engineResult).slice(0, 4000);
      if ((engineResult as { status: string }).status === "failed") {
        await failChainStep({
          taskId,
          reason: "Lead research failed — kamu kaynak fetch hataları",
          actorAgent: "growth-lead",
        });
        await postMessage({
          from: "growth-lead",
          to: "ceo",
          taskId,
          parentTaskId: task.parentTaskId,
          chainId: task.chainId,
          kind: "failure",
          summary: "Growth research başarısız; CEO’ya iletildi.",
          payload: engineResult,
        });
        return { ok: false, step, engineResult, reason: "engine_failed" };
      }
    } else if (step === "seo_audit") {
      engineResult = await runTechnicalSeoScan({ chainId: task.chainId });
      resultText = JSON.stringify(engineResult).slice(0, 4000);
      if ((engineResult as { status: string }).status === "failed") {
        await failChainStep({
          taskId,
          reason: "SEO scan failed — site erişilemedi",
          actorAgent: "seo-specialist",
        });
        await postMessage({
          from: "seo-specialist",
          to: "ceo",
          taskId,
          parentTaskId: task.parentTaskId,
          chainId: task.chainId,
          kind: "failure",
          summary: "SEO tarama başarısız; CEO’ya iletildi.",
          payload: engineResult,
        });
        return { ok: false, step, engineResult, reason: "engine_failed" };
      }
    } else if (step === "content_draft") {
      engineResult = await createContentDraftsFromSeo({ chainId: task.chainId });
      resultText = JSON.stringify(engineResult).slice(0, 4000);
    } else if (step === "ads_proposal") {
      engineResult = await createAdProposals({ chainId: task.chainId });
      resultText = JSON.stringify(engineResult).slice(0, 4000);
    } else {
      // ceo_growth_close
      const [leads, seo, drafts, ads] = await Promise.all([
        prisma.lead.count(),
        prisma.seoFinding.count({ where: { findingKind: "measured" } }),
        prisma.contentDraftRecord.count(),
        prisma.adProposal.count(),
      ]);
      engineResult = {
        leads,
        measuredSeoFindings: seo,
        drafts,
        adProposals: ads,
        llmMissing: true,
        liveAds: false,
        outreach: false,
      };
      resultText = `CEO kapanış: leads=${leads}, seoMeasured=${seo}, drafts=${drafts}, ads=${ads}. LLM yok; yayın/reklam/ileti yok.`;
      await postMessage({
        from: "ceo",
        to: "ceo",
        taskId,
        parentTaskId: task.parentTaskId,
        chainId: task.chainId,
        kind: "result",
        summary: resultText,
        payload: engineResult,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await failChainStep({ taskId, reason: msg, actorAgent: task.assigneeId });
    await postMessage({
      from: task.assigneeId,
      to: "ceo",
      taskId,
      parentTaskId: task.parentTaskId,
      chainId: task.chainId,
      kind: "failure",
      summary: `Adım hatası: ${step} — ${msg}`.slice(0, 1000),
    });
    return { ok: false, step, reason: msg };
  }

  const done = await completeChainStep({
    taskId,
    result: resultText,
    actorAgent: task.assigneeId,
  });
  return {
    ok: done.ok,
    step,
    engineResult,
    unlockedTaskId: done.unlockedTaskId,
    reason: done.reason,
  };
}

async function recoverWaitingGrowthSteps(chainId: string): Promise<number> {
  const prisma = getPrisma();
  const waiting = await prisma.task.findMany({
    where: {
      chainId,
      parentTaskId: { not: null },
      workflowPhase: "waiting_dependency",
      archivedAt: null,
    },
  });
  let unlocked = 0;
  for (const step of waiting) {
    if (!step.dependsOnTaskId) continue;
    const dep = await prisma.task.findUnique({
      where: { id: step.dependsOnTaskId },
      select: { workflowPhase: true, status: true },
    });
    if (dep?.workflowPhase !== "completed" && dep?.status !== "done") continue;
    await prisma.task.update({
      where: { id: step.id },
      data: {
        workflowPhase: "ready",
        status: "planned",
        dispatchState: "ready",
        blockedReason: null,
      },
    });
    unlocked += 1;
  }
  return unlocked;
}

/** Scheduler: mevcut growth zincirini ilerlet; sahte yeni zincir açmaz. */
export async function runGrowthAutonomyCycle(): Promise<{
  skipped?: string;
  chainId?: string;
  executedSteps?: string[];
  realAiExecution: false;
}> {
  const kill = await getKillSwitch();
  if (kill.enabled) return { skipped: "kill_switch", realAiExecution: false };

  const prisma = getPrisma();
  const openParents = await prisma.task.findMany({
    where: {
      origin: "growth:faz5c",
      parentTaskId: null,
      status: { in: ["in_progress", "planned"] },
      chainId: { not: null },
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 4,
  });

  const executedSteps: string[] = [];
  let lastChain: string | undefined;

  for (const parent of openParents) {
    if (!parent.chainId) continue;
    lastChain = parent.chainId;
    await recoverWaitingGrowthSteps(parent.chainId);
    for (let i = 0; i < 2; i++) {
      const ready = await prisma.task.findFirst({
        where: {
          chainId: parent.chainId,
          parentTaskId: { not: null },
          workflowPhase: "ready",
          status: { notIn: ["done", "failed"] },
          chainStep: { in: [...GROWTH_STEPS] },
          archivedAt: null,
        },
        orderBy: { chainOrder: "asc" },
      });
      if (!ready) break;
      const res = await executeGrowthStep(ready.id);
      executedSteps.push(`${ready.chainStep}:${res.ok ? "ok" : res.reason}`);
      if (!res.ok) break;
    }
  }

  if (executedSteps.length > 0) {
    return { chainId: lastChain, executedSteps, realAiExecution: false };
  }

  const ceoAssignedGrowth = await prisma.task.count({
    where: {
      archivedAt: null,
      parentTaskId: { not: null },
      assigneeId: { in: ["growth-lead", "seo-specialist", "content-manager", "ads-manager"] },
      status: { in: ["planned", "in_progress"] },
      dispatchState: "ready",
    },
  });
  if (ceoAssignedGrowth > 0) {
    return {
      skipped: "ceo_growth_tasks_pending_agent_pass",
      chainId: lastChain,
      executedSteps: [],
      realAiExecution: false,
    };
  }

  return {
    skipped: "no_ready_growth_step",
    chainId: lastChain,
    executedSteps: [],
    realAiExecution: false,
  };
}

/** Test yardımcısı: tüm growth adımlarını motorlarla yürüt. */
export async function simulateGrowthChain(chainId: string) {
  const prisma = getPrisma();
  const executed: string[] = [];
  for (const step of GROWTH_STEPS) {
    const task = await prisma.task.findFirst({
      where: { chainId, chainStep: step, parentTaskId: { not: null }, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (!task) throw new Error(`missing:${step}`);
    if (task.workflowPhase === "completed") {
      executed.push(`${step}:already`);
      continue;
    }
    const fresh = await prisma.task.findUnique({ where: { id: task.id } });
    if (fresh?.workflowPhase === "waiting_dependency") {
      throw new Error(`blocked:${step}`);
    }
    const res = await executeGrowthStep(task.id);
    if (!res.ok) throw new Error(`fail:${step}:${res.reason}`);
    executed.push(`${step}:ok`);
  }
  return { realAiExecution: false as const, executed };
}
