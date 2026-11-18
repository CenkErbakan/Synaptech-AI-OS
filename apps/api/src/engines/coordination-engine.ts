import { randomUUID } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { killSwitchActive } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";

/** Yazılım teslim zinciri — deterministik koordinasyon (gerçek AI yürütmesi değil). */
export const CHAIN_STEPS = [
  "ceo_plan",
  "cto_spec",
  "develop",
  "test",
  "cto_review",
  "ceo_close",
] as const;

export type ChainStep = (typeof CHAIN_STEPS)[number];

export type WorkflowPhase =
  | "waiting_dependency"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "rework";

export type ExecutionKind =
  | "deterministic"
  | "real_ai_pending"
  | "mock_llm"
  | "local_llm"
  | "cloud_coding";

const STEP_META: Record<
  ChainStep,
  {
    order: number;
    agentId: string;
    title: string;
    statusOnReady: string;
    acceptance: string;
  }
> = {
  ceo_plan: {
    order: 1,
    agentId: "ceo",
    title: "CEO planı",
    statusOnReady: "planned",
    acceptance: "Kapsam, öncelik ve başarı ölçütü yazılı; CTO’ya devredildi.",
  },
  cto_spec: {
    order: 2,
    agentId: "cto",
    title: "CTO teknik spesifikasyon",
    statusOnReady: "planned",
    acceptance: "Teknik adımlar, riskler ve developer kabul kriteri net.",
  },
  develop: {
    order: 3,
    agentId: "developer",
    title: "Developer uygulama",
    statusOnReady: "planned",
    acceptance: "Değişiklik özeti + doğrulama notu; test’e hazır.",
  },
  test: {
    order: 4,
    agentId: "tester",
    title: "Tester doğrulama",
    statusOnReady: "planned",
    acceptance: "Kabul kriterleri doğrulandı veya başarısızlık gerekçesi yazıldı.",
  },
  cto_review: {
    order: 5,
    agentId: "cto",
    title: "CTO inceleme",
    statusOnReady: "in_review",
    acceptance: "Test sonucu incelendi; CEO’ya nihai özet verildi.",
  },
  ceo_close: {
    order: 6,
    agentId: "ceo",
    title: "CEO kapanış",
    statusOnReady: "planned",
    acceptance: "Nihai sonuç kaydedildi; zincir kapatıldı.",
  },
};

async function postMessage(input: {
  from: string;
  to: string;
  taskId?: string | null;
  parentTaskId?: string | null;
  chainId: string;
  kind: string;
  summary: string;
  evidenceRef?: string | null;
  payload?: unknown;
}) {
  const prisma = getPrisma();
  return prisma.agentMessage.create({
    data: {
      fromAgentId: input.from,
      toAgentId: input.to,
      taskId: input.taskId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      chainId: input.chainId,
      kind: input.kind,
      summary: input.summary.slice(0, 1000),
      evidenceRef: input.evidenceRef ?? null,
      payloadJson: input.payload ? JSON.stringify(input.payload).slice(0, 8000) : null,
    },
  });
}

export interface StartChainInput {
  projectSlug: string;
  title: string;
  description?: string;
  opportunityId?: string | null;
  origin?: string | null;
  idempotencyKey: string;
  executionKind?: ExecutionKind;
}

export interface ChainStartResult {
  mode: "deterministic_coordination";
  realAiExecution: false;
  chainId: string;
  parentTaskId: string;
  steps: Array<{ id: string; step: ChainStep; agentId: string; workflowPhase: WorkflowPhase }>;
}

/**
 * CEO → CTO → Developer → Tester → CTO → CEO zinciri oluşturur.
 * Yalnızca ilk adım ready; diğerleri waiting_dependency.
 */
export async function startSoftwareDeliveryChain(
  input: StartChainInput,
): Promise<ChainStartResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: koordinasyon zinciri yok.");

  const prisma = getPrisma();
  const existing = await prisma.task.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing?.chainId) {
    const steps = await prisma.task.findMany({
      where: { chainId: existing.chainId, parentTaskId: existing.id },
      orderBy: { chainOrder: "asc" },
    });
    return {
      mode: "deterministic_coordination",
      realAiExecution: false,
      chainId: existing.chainId,
      parentTaskId: existing.id,
      steps: steps.map((s) => ({
        id: s.id,
        step: s.chainStep as ChainStep,
        agentId: s.assigneeId,
        workflowPhase: (s.workflowPhase ?? "waiting_dependency") as WorkflowPhase,
      })),
    };
  }

  const project = await prisma.project.findUnique({ where: { slug: input.projectSlug } });
  if (!project) throw new Error(`project_not_found:${input.projectSlug}`);

  const chainId = randomUUID();
  const parentId = randomUUID();
  const now = new Date();
  const executionKind: ExecutionKind = input.executionKind ?? "deterministic";
  const origin = input.origin ?? (input.opportunityId ? `opportunity:${input.opportunityId}` : "coordination");

  const stepIds = Object.fromEntries(CHAIN_STEPS.map((s) => [s, randomUUID()])) as Record<
    ChainStep,
    string
  >;

  await prisma.$transaction(async (tx) => {
    await tx.task.create({
      data: {
        id: parentId,
        source: "real",
        title: input.title.slice(0, 140),
        description: [
          input.description ?? "Yazılım teslim koordinasyon zinciri (Faz 5B).",
          "executionKind=" + executionKind,
          "NOT: Bu zincir deterministik koordinasyondur; gerçek AI ajan yürütmesi değildir.",
        ].join("\n"),
        projectId: project.id,
        assigneeId: "ceo",
        priority: "medium",
        status: "in_progress",
        dispatchState: "not_applicable",
        executionPolicy: "AUTO",
        origin,
        chainId,
        chainStep: "ceo_plan",
        chainOrder: 0,
        workflowPhase: "running",
        executionKind,
        acceptanceCriteria: "Tüm zincir adımları completed veya kontrollü failed+rework ile kapanır.",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
    });
    await tx.taskEvent.create({
      data: {
        taskId: parentId,
        actorKind: "agent",
        actorAgent: "ceo",
        type: "created",
        message: "Koordinasyon zinciri parent görevi oluşturuldu.",
        toStatus: "in_progress",
      },
    });

    let prevId: string | null = null;
    for (const step of CHAIN_STEPS) {
      const meta = STEP_META[step];
      const id = stepIds[step];
      const isFirst = step === "ceo_plan";
      const phase: WorkflowPhase = isFirst ? "ready" : "waiting_dependency";
      const status = isFirst ? meta.statusOnReady : "backlog";
      await tx.task.create({
        data: {
          id,
          source: "real",
          title: `${meta.title}: ${input.title}`.slice(0, 140),
          description: [
            `Zincir adımı: ${step}`,
            `Agent: ${meta.agentId}`,
            `executionKind=${executionKind}`,
            "Gerçek AI yürütmesi yok — deterministik mock koordinasyon.",
          ].join("\n"),
          projectId: project.id,
          assigneeId: meta.agentId,
          priority: "medium",
          status,
          dispatchState: isFirst ? "ready" : "not_applicable",
          executionPolicy: "AUTO",
          origin,
          parentTaskId: parentId,
          chainId,
          chainStep: step,
          chainOrder: meta.order,
          dependsOnTaskId: prevId,
          workflowPhase: phase,
          blockedReason: isFirst ? null : `depends_on:${prevId}`,
          acceptanceCriteria: meta.acceptance,
          executionKind,
          idempotencyKey: `${input.idempotencyKey}:${step}`,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.taskEvent.create({
        data: {
          taskId: id,
          actorKind: "agent",
          actorAgent: "ceo",
          type: "created",
          message: isFirst
            ? `${meta.agentId} adımı ready (bağımlılık yok).`
            : `${meta.agentId} adımı waiting_dependency.`,
          toStatus: status,
        },
      });
      await tx.taskAssignment.create({
        data: { taskId: id, agentId: meta.agentId, note: `Faz 5B zincir: ${step}` },
      });
      prevId = id;
    }
  });

  await postMessage({
    from: "ceo",
    to: "cto",
    taskId: stepIds.ceo_plan,
    parentTaskId: parentId,
    chainId,
    kind: "handoff",
    summary: "CEO zinciri başlattı; ceo_plan ready. CTO adımı bağımlılık bekliyor.",
    payload: { chainId, step: "ceo_plan", executionKind, realAiExecution: false },
  });

  await writeAudit({
    category: "coordination",
    action: "chain.started",
    actorKind: "agent",
    actorAgent: "ceo",
    targetType: "task",
    targetId: parentId,
    summary: "Yazılım teslim zinciri başlatıldı (deterministik koordinasyon).",
    metadata: { chainId, executionKind, realAiExecution: false, steps: CHAIN_STEPS },
  });

  return {
    mode: "deterministic_coordination",
    realAiExecution: false,
    chainId,
    parentTaskId: parentId,
    steps: CHAIN_STEPS.map((step) => ({
      id: stepIds[step],
      step,
      agentId: STEP_META[step].agentId,
      workflowPhase: (step === "ceo_plan" ? "ready" : "waiting_dependency") as WorkflowPhase,
    })),
  };
}

async function unlockNext(taskId: string, chainId: string, parentTaskId: string) {
  const prisma = getPrisma();
  const next = await prisma.task.findFirst({
    where: { chainId, dependsOnTaskId: taskId, source: "real", archivedAt: null },
  });
  if (!next) return null;

  const meta = STEP_META[next.chainStep as ChainStep];
  const updated = await prisma.task.update({
    where: { id: next.id },
    data: {
      workflowPhase: "ready",
      status: meta?.statusOnReady ?? "planned",
      dispatchState: "ready",
      blockedReason: null,
      startedAt: null,
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId: next.id,
      actorKind: "system",
      type: "unblocked",
      message: `Bağımlılık tamamlandı; ${next.assigneeId} adımı ready.`,
      toStatus: updated.status,
    },
  });
  await postMessage({
    from: "system",
    to: next.assigneeId,
    taskId: next.id,
    parentTaskId,
    chainId,
    kind: "unblock",
    summary: `${next.chainStep} bağımlılığı kalktı — ajan görevi alabilir (deterministik).`,
    payload: { previousTaskId: taskId, step: next.chainStep },
  });
  return updated;
}

export async function startChainStep(taskId: string): Promise<{ ok: boolean; reason?: string }> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const prisma = getPrisma();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !task.chainId || !task.chainStep) {
    return { ok: false, reason: "not_chain_step" };
  }
  if (task.workflowPhase === "waiting_dependency") {
    return { ok: false, reason: "waiting_dependency" };
  }
  if (task.workflowPhase === "completed") {
    return { ok: false, reason: "already_completed" };
  }
  if (task.dependsOnTaskId) {
    const dep = await prisma.task.findUnique({ where: { id: task.dependsOnTaskId } });
    if (!dep || dep.workflowPhase !== "completed") {
      return { ok: false, reason: "dependency_not_completed" };
    }
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      workflowPhase: "running",
      status: task.chainStep === "test" ? "testing" : task.chainStep === "cto_review" ? "in_review" : "in_progress",
      startedAt: new Date(),
      dispatchState: "dispatched",
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId,
      actorKind: "agent",
      actorAgent: task.assigneeId,
      type: "started",
      message: `${task.assigneeId} adımı çalışıyor (executionKind=${task.executionKind ?? "deterministic"}).`,
      toStatus: "in_progress",
    },
  });
  return { ok: true };
}

export async function completeChainStep(input: {
  taskId: string;
  result: string;
  actorAgent?: string;
}): Promise<{
  ok: boolean;
  unlockedTaskId: string | null;
  chainClosed: boolean;
  reason?: string;
}> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const prisma = getPrisma();
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task?.chainId || !task.chainStep || !task.parentTaskId) {
    return { ok: false, unlockedTaskId: null, chainClosed: false, reason: "not_chain_step" };
  }
  if (task.workflowPhase === "waiting_dependency") {
    return { ok: false, unlockedTaskId: null, chainClosed: false, reason: "waiting_dependency" };
  }
  if (task.dependsOnTaskId) {
    const dep = await prisma.task.findUnique({ where: { id: task.dependsOnTaskId } });
    if (!dep || dep.workflowPhase !== "completed") {
      return { ok: false, unlockedTaskId: null, chainClosed: false, reason: "dependency_not_completed" };
    }
  }

  const now = new Date();
  if (task.workflowPhase !== "running") {
    await startChainStep(task.id);
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      workflowPhase: "completed",
      status: "done",
      executionResult: input.result.slice(0, 24_000),
      finishedAt: now,
      dispatchState: "not_applicable",
      blockedReason: null,
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorKind: "agent",
      actorAgent: input.actorAgent ?? task.assigneeId,
      type: "completed",
      message: `Adım tamamlandı: ${task.chainStep}`,
      fromStatus: task.status,
      toStatus: "done",
    },
  });

  const nextAgent =
    task.chainStep === "ceo_close"
      ? "ceo"
      : STEP_META[CHAIN_STEPS[CHAIN_STEPS.indexOf(task.chainStep as ChainStep) + 1] as ChainStep]
          ?.agentId ?? "ceo";

  await postMessage({
    from: task.assigneeId,
    to: nextAgent,
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    chainId: task.chainId,
    kind: "result",
    summary: `${task.chainStep} tamamlandı → sonraki ajan: ${nextAgent}.`,
    evidenceRef: `task:${task.id}:result`,
    payload: {
      step: task.chainStep,
      result: input.result.slice(0, 2000),
      executionKind: task.executionKind,
      realAiExecution: false,
    },
  });

  const unlocked = await unlockNext(task.id, task.chainId, task.parentTaskId);
  let chainClosed = false;

  const isCloseStep =
    task.chainStep === "ceo_close" || task.chainStep === "ceo_growth_close";
  if (isCloseStep) {
    await prisma.task.update({
      where: { id: task.parentTaskId },
      data: {
        status: "done",
        workflowPhase: "completed",
        finishedAt: now,
        executionResult: input.result.slice(0, 8000),
      },
    });
    chainClosed = true;
    await postMessage({
      from: "ceo",
      to: "ceo",
      taskId: task.parentTaskId,
      parentTaskId: task.parentTaskId,
      chainId: task.chainId,
      kind: "chain_closed",
      summary: "CEO nihai sonucu kaydetti; zincir kapandı.",
      payload: { chainId: task.chainId, realAiExecution: false },
    });
  }

  await writeAudit({
    category: "coordination",
    action: "chain.step_completed",
    actorKind: "agent",
    actorAgent: task.assigneeId,
    targetType: "task",
    targetId: task.id,
    summary: `Zincir adımı tamamlandı: ${task.chainStep}`,
    metadata: {
      chainId: task.chainId,
      unlockedTaskId: unlocked?.id ?? null,
      chainClosed,
      realAiExecution: false,
    },
  });

  return { ok: true, unlockedTaskId: unlocked?.id ?? null, chainClosed };
}

/**
 * Test başarısızlığı: developer rework açılır, CTO+CEO bilgilendirilir.
 */
export async function failChainStep(input: {
  taskId: string;
  reason: string;
  actorAgent?: string;
}): Promise<{
  ok: boolean;
  reworkTaskId: string | null;
  reason?: string;
}> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const prisma = getPrisma();
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task?.chainId || !task.chainStep || !task.parentTaskId) {
    return { ok: false, reworkTaskId: null, reason: "not_chain_step" };
  }

  const now = new Date();
  await prisma.task.update({
    where: { id: task.id },
    data: {
      workflowPhase: "failed",
      status: "failed",
      executionResult: input.reason.slice(0, 8000),
      finishedAt: now,
      dispatchState: "failed",
      blockedReason: input.reason.slice(0, 500),
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorKind: "agent",
      actorAgent: input.actorAgent ?? task.assigneeId,
      type: "failed",
      message: input.reason.slice(0, 1000),
      toStatus: "failed",
    },
  });

  await postMessage({
    from: task.assigneeId,
    to: "ceo",
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    chainId: task.chainId,
    kind: "failure",
    summary: `Başarısızlık: ${task.chainStep} — CEO bilgilendirildi.`,
    payload: { reason: input.reason, step: task.chainStep, realAiExecution: false },
  });
  await postMessage({
    from: task.assigneeId,
    to: "cto",
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    chainId: task.chainId,
    kind: "failure",
    summary: `Başarısızlık: ${task.chainStep} — CTO bilgilendirildi.`,
    payload: { reason: input.reason, step: task.chainStep },
  });

  let reworkTaskId: string | null = null;

  // Test veya review fail → develop rework
  if (task.chainStep === "test" || task.chainStep === "cto_review") {
    const develop = await prisma.task.findFirst({
      where: { chainId: task.chainId, chainStep: "develop", archivedAt: null },
    });
    if (develop) {
      const reworkId = randomUUID();
      await prisma.task.create({
        data: {
          id: reworkId,
          source: "real",
          title: `Rework: ${develop.title}`.slice(0, 140),
          description: [
            "Başarısız adımdan dönen rework (deterministik).",
            `Kaynak adım: ${task.chainStep} (${task.id})`,
            `Gerekçe: ${input.reason}`,
          ].join("\n"),
          projectId: develop.projectId,
          assigneeId: "developer",
          priority: "high",
          status: "planned",
          dispatchState: "ready",
          executionPolicy: "AUTO",
          origin: develop.origin,
          parentTaskId: task.parentTaskId,
          chainId: task.chainId,
          chainStep: "develop",
          chainOrder: develop.chainOrder,
          dependsOnTaskId: null,
          workflowPhase: "rework",
          acceptanceCriteria: develop.acceptanceCriteria,
          executionKind: develop.executionKind ?? "deterministic",
          blockedReason: null,
          idempotencyKey: `rework:${task.id}:${Date.now()}`,
          createdAt: now,
          updatedAt: now,
        },
      });
      await prisma.taskAssignment.create({
        data: { taskId: reworkId, agentId: "developer", note: "Failback rework" },
      });
      // Orijinal test adımını rework tamamlanınca tekrar açmak için bağımlılık güncelle
      await prisma.task.update({
        where: { id: task.id },
        data: {
          dependsOnTaskId: reworkId,
          workflowPhase: "waiting_dependency",
          status: "backlog",
          dispatchState: "not_applicable",
          blockedReason: `rework:${reworkId}`,
          finishedAt: null,
        },
      });
      // Sonraki kilitli adımları da beklemeye al (test’ten sonrası)
      await prisma.task.updateMany({
        where: {
          chainId: task.chainId,
          chainOrder: { gt: task.chainOrder ?? 0 },
          workflowPhase: { not: "completed" },
        },
        data: {
          workflowPhase: "waiting_dependency",
          status: "backlog",
          blockedReason: `upstream_failed:${task.id}`,
        },
      });

      reworkTaskId = reworkId;
      await postMessage({
        from: "ceo",
        to: "developer",
        taskId: reworkId,
        parentTaskId: task.parentTaskId,
        chainId: task.chainId,
        kind: "rework",
        summary: "CEO/sistem: test başarısızlığı sonrası developer rework açıldı.",
        payload: { failedTaskId: task.id, reworkTaskId: reworkId },
      });
    }
  }

  await writeAudit({
    category: "coordination",
    action: "chain.step_failed",
    actorKind: "agent",
    actorAgent: task.assigneeId,
    targetType: "task",
    targetId: task.id,
    summary: `Zincir adımı başarısız: ${task.chainStep}`,
    metadata: { chainId: task.chainId, reworkTaskId, reason: input.reason.slice(0, 500) },
  });

  return { ok: true, reworkTaskId };
}

/** Mock E2E: tüm adımları sırayla tamamlar (deterministik). */
export async function simulateFullChainSuccess(chainId: string): Promise<{
  mode: "deterministic_simulation";
  realAiExecution: false;
  completed: string[];
}> {
  const prisma = getPrisma();
  const completed: string[] = [];
  for (const stepName of CHAIN_STEPS) {
    const step = await prisma.task.findFirst({
      where: {
        chainId,
        chainStep: stepName,
        parentTaskId: { not: null }, // parent görev aynı chainStep etiketini taşıyabilir
        workflowPhase: { notIn: ["rework"] },
        archivedAt: null,
      },
      orderBy: [{ chainOrder: "asc" }, { createdAt: "asc" }],
    });
    if (!step) throw new Error(`simulate_missing_step:${stepName}`);
    if (step.workflowPhase === "completed") {
      completed.push(step.id);
      continue;
    }
    // Bağımlılık açılmış olmalı; değilse kısa bekleme yok — hata
    const fresh = await prisma.task.findUnique({ where: { id: step.id } });
    if (!fresh) throw new Error(`simulate_missing:${stepName}`);
    if (fresh.workflowPhase === "waiting_dependency") {
      throw new Error(`simulate_blocked:${stepName}:waiting_dependency`);
    }
    if (fresh.workflowPhase === "ready" || fresh.workflowPhase === "failed") {
      // failed test yeniden açılmış olabilir
      if (fresh.workflowPhase === "failed") {
        await prisma.task.update({
          where: { id: fresh.id },
          data: { workflowPhase: "ready", status: "planned", dispatchState: "ready", blockedReason: null },
        });
      }
      const start = await startChainStep(fresh.id);
      if (!start.ok && start.reason !== "already_completed") {
        // running'e geçemediyse yine dene complete öncesi
        if (start.reason === "waiting_dependency" || start.reason === "dependency_not_completed") {
          throw new Error(`simulate_blocked:${stepName}:${start.reason}`);
        }
      }
    }
    const res = await completeChainStep({
      taskId: fresh.id,
      result: `Deterministik mock sonuç: ${stepName} OK`,
      actorAgent: fresh.assigneeId,
    });
    if (!res.ok) throw new Error(`simulate_fail:${stepName}:${res.reason}`);
    completed.push(fresh.id);
  }
  return { mode: "deterministic_simulation", realAiExecution: false, completed };
}

export async function getChainSnapshot(chainId: string) {
  const prisma = getPrisma();
  const parent = await prisma.task.findFirst({
    where: { chainId, parentTaskId: null, archivedAt: null },
    include: { project: true },
  });
  const steps = await prisma.task.findMany({
    where: { chainId, parentTaskId: { not: null }, archivedAt: null },
    orderBy: [{ chainOrder: "asc" }, { createdAt: "asc" }],
  });
  const messages = await prisma.agentMessage.findMany({
    where: { chainId },
    orderBy: { createdAt: "asc" },
  });
  return {
    source: "api" as const,
    mode: "deterministic_coordination" as const,
    realAiExecution: false as const,
    llmIntegrated: false as const,
    chainId,
    parent: parent
      ? {
          id: parent.id,
          title: parent.title,
          status: parent.status,
          workflowPhase: parent.workflowPhase,
          projectSlug: parent.project.slug,
          executionKind: parent.executionKind,
          executionResult: parent.executionResult,
        }
      : null,
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      chainStep: s.chainStep,
      chainOrder: s.chainOrder,
      assigneeId: s.assigneeId,
      status: s.status,
      workflowPhase: s.workflowPhase,
      dependsOnTaskId: s.dependsOnTaskId,
      acceptanceCriteria: s.acceptanceCriteria,
      executionResult: s.executionResult,
      executionKind: s.executionKind,
      blockedReason: s.blockedReason,
      dispatchState: s.dispatchState,
      updatedAt: s.updatedAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      fromAgentId: m.fromAgentId,
      toAgentId: m.toAgentId,
      taskId: m.taskId,
      kind: m.kind,
      summary: m.summary,
      evidenceRef: m.evidenceRef,
      payloadJson: m.payloadJson,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
