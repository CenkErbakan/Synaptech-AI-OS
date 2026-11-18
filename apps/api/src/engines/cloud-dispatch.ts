import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getPrisma } from "../db/prisma.js";
import { getEnv, repoRoot } from "../lib/env.js";
import { conflict, forbidden, killSwitchActive, notFound, validationError } from "../lib/errors.js";
import { getCursorCloudAdapter } from "../cursor/adapter.js";
import { computeCloudRunContentVersion } from "../cursor/pilot-policy.js";
import { safeErrorMessage } from "../cursor/sanitize.js";
import { writeAudit } from "./audit.js";
import { createApproval } from "./approval-engine.js";
import { getKillSwitch } from "./kill-switch.js";
import { loadTask } from "./task-engine.js";

const ACTIVE_CURSOR = new Set(["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"]);

const PILOT_BRIEF_RELATIVE = "tasks/T-P4B-001-pilot-ts-hello.md";

function readPilotBriefSha256(): string | undefined {
  const briefPath = path.resolve(repoRoot(), PILOT_BRIEF_RELATIVE);
  if (!existsSync(briefPath)) return undefined;
  return createHash("sha256").update(readFileSync(briefPath)).digest("hex");
}

function resolveCloudContentVersion(input: {
  title: string;
  description: string;
  repositoryUrl: string;
}): string {
  const env = getEnv();
  return computeCloudRunContentVersion({
    title: input.title,
    description: input.description,
    repositoryUrl: input.repositoryUrl,
    startingRef: env.CLOUD_AGENT_STARTING_REF,
    briefSha256: readPilotBriefSha256(),
  });
}

/** Gerçek Cloud eşzamanlılık — yalnızca live. Mock bu sınırı tüketmez. */
export async function countActiveLiveCloudRuns(): Promise<number> {
  const prisma = getPrisma();
  return prisma.agentRun.count({
    where: {
      executionMode: "live",
      cursorStatus: { in: [...ACTIVE_CURSOR] },
      NOT: { reconcileState: { in: ["stale_mock", "archived"] } },
    },
  });
}

export async function countActiveMockCloudRuns(): Promise<number> {
  const prisma = getPrisma();
  return prisma.agentRun.count({
    where: {
      executionMode: "mock",
      cursorStatus: { in: [...ACTIVE_CURSOR] },
      NOT: { reconcileState: { in: ["stale_mock", "archived"] } },
    },
  });
}

/** Geriye uyum: canlı kapasite (mock hariç). */
export async function countActiveCloudRuns(): Promise<number> {
  return countActiveLiveCloudRuns();
}

/** CEO görevi sonrası: onay talebi oluştur, dispatchState = awaiting_execution_approval. */
export async function prepareCloudExecutionGate(taskId: string): Promise<{
  taskId: string;
  approvalId: string;
  contentVersion: string;
  dispatchState: string;
}> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const task = await loadTask(taskId);
  const env = getEnv();
  const repoHint =
    env.CLOUD_AGENT_ALLOWED_REPOS[0] ?? "(izinli test repository henüz tanımlı değil — Owner eklemeli)";
  const briefSha = readPilotBriefSha256();
  const version = resolveCloudContentVersion({
    title: task.title,
    description: task.description,
    repositoryUrl: repoHint.startsWith("http") ? repoHint : "pending-repo",
  });

  const approval = await createApproval({
    type: "cloud_agent_run",
    requestedBy: "ceo",
    projectSlug: task.projectSlug,
    taskId: task.id,
    title: `Cloud Agent: ${task.title}`,
    description: [
      "Faz 4B: Gerçek Cloud çalıştırma varsayılan kapalıdır.",
      "Onay, belirli görev + repository + içerik hash + branch politikası için geçerlidir.",
      `İzinli repo (örnek): ${repoHint}`,
      `startingRef (base): ${env.CLOUD_AGENT_STARTING_REF} — main/master korumalı; çalışma branch'i cursor/ veya agent/`,
      "autoCreatePR=false; otomatik merge/deploy yasak.",
      briefSha ? `Görev brief SHA-256: ${briefSha}` : "Görev brief dosyası bulunamadı.",
      `contentVersion: ${version}`,
    ].join("\n"),
    changeSummary: `Görev ${task.id} için Cursor Cloud run talebi (contentVersion bağlı).`,
    risk: "high",
    subjectKind: "payload_sha256",
    subjectRef: `task:${task.id}`,
    subjectVersion: version,
  });

  const prisma = getPrisma();
  await prisma.task.update({
    where: { id: task.id },
    data: {
      dispatchState: "awaiting_execution_approval",
      approvalId: approval.id,
    },
  });
  await prisma.agentRun.create({
    data: {
      taskId: task.id,
      agentId: task.assignee,
      status: "awaiting_execution_approval",
      message: "Owner cloud_agent_run onayı bekleniyor.",
      approvalId: approval.id,
      executionMode: "mock",
    },
  });

  await writeAudit({
    category: "cloud",
    action: "cloud.execution_gate_created",
    actorKind: "agent",
    actorAgent: "ceo",
    targetType: "task",
    targetId: task.id,
    summary: "Cloud yürütme onayı talebi oluşturuldu.",
    metadata: { approvalId: approval.id, contentVersion: version },
  });

  return {
    taskId: task.id,
    approvalId: approval.id,
    contentVersion: version,
    dispatchState: "awaiting_execution_approval",
  };
}

/**
 * Owner onayından sonra Cloud run başlatır.
 * Live bayrak kapalıysa mock run (ücret yok). Live açıksa bile Faz 4B onayı ayrıca gerekir —
 * burada CLOUD_AGENT_LIVE_ENABLED kontrol edilir.
 */
export async function executeApprovedCloudRun(input: {
  taskId: string;
  approvalId: string;
  repositoryUrl: string;
  actorKind?: "owner" | "system";
}): Promise<{
  ok: boolean;
  taskId: string;
  cursorAgentId?: string;
  cursorRunId?: string;
  mode?: string;
  message: string;
  dispatchState: string;
}> {
  if (input.actorKind && input.actorKind !== "owner") {
    throw forbidden("Cloud run yalnızca Owner onayıyla başlatılır; ajan kendi onayını veremez.");
  }

  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch açık: yeni Cloud Agent oluşturulamaz.");

  const prisma = getPrisma();
  const env = getEnv();
  const task = await loadTask(input.taskId);

  const approval = await prisma.approval.findUnique({ where: { id: input.approvalId } });
  if (!approval || approval.source !== "real") throw notFound("Onay bulunamadı.");
  if (approval.type !== "cloud_agent_run") throw validationError("Onay türü cloud_agent_run olmalı.");
  if (approval.status !== "approved") throw validationError("Onay henüz verilmemiş veya geçersiz.");
  if (approval.taskId !== task.id) throw validationError("Onay bu görev için değil.");
  if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
    throw validationError("Onay süresi dolmuş.");
  }

  const currentVersion = resolveCloudContentVersion({
    title: task.title,
    description: task.description,
    repositoryUrl: input.repositoryUrl,
  });
  if (!approval.boundVersion || approval.boundVersion !== currentVersion) {
    await prisma.task.update({
      where: { id: task.id },
      data: { dispatchState: "awaiting_execution_approval" },
    });
    throw validationError(
      "Görev içeriği / brief hash / branch politikası onaylanan sürümden farklı; çalıştırma engellendi. Yeni Owner onayı gerekir.",
    );
  }
  if (approval.subjectVersion && approval.subjectVersion !== currentVersion) {
    throw validationError(
      "Onay subjectVersion ile güncel contentVersion uyuşmuyor; çalıştırma engellendi.",
    );
  }

  if (approval.subjectRef !== `task:${task.id}` && approval.taskId !== task.id) {
    throw validationError("Onay subjectRef görev ile eşleşmiyor.");
  }

  // Çift çalıştırma: aynı görevde aktif cursor run var mı?
  const existingActive = await prisma.agentRun.findFirst({
    where: {
      taskId: task.id,
      cursorStatus: { in: [...ACTIVE_CURSOR] },
    },
  });
  if (existingActive) {
    throw conflict("Bu görev için zaten aktif bir Cloud run var.");
  }

  const willBeLive = env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE === "live";
  if (willBeLive) {
    // Faz 5E: maliyet limiti + onay doğrulaması olmadan Cloud Agent başlatma
    const { assertCloudCreateAllowed } = await import("../ai/budget-gate.js");
    const gate = assertCloudCreateAllowed({
      hasOwnerApproval: true,
      approvalType: "cloud_agent_run",
    });
    if (!gate.ok) {
      throw forbidden(
        `Cloud live create engellendi (${gate.reason}). Kalan kullanım bilinmiyor; tahminle izin yok. Owner pilot onayı gerekir.`,
      );
    }
    const activeLive = await countActiveLiveCloudRuns();
    if (activeLive >= 1) {
      throw conflict("Aynı anda en fazla 1 canlı Cloud Agent run.");
    }
  }

  // Idempotency: aynı approval için daha önce başarılı create
  const prior = await prisma.agentRun.findFirst({
    where: {
      approvalId: approval.id,
      cursorAgentId: { not: null },
      status: { not: "failed" },
    },
    orderBy: { createdAt: "desc" },
  });
  if (prior?.cursorAgentId && prior.cursorRunId) {
    return {
      ok: true,
      taskId: task.id,
      cursorAgentId: prior.cursorAgentId,
      cursorRunId: prior.cursorRunId,
      mode: prior.executionMode ?? undefined,
      message: "Idempotent: mevcut run kaydı döndürüldü (yeniden create yok).",
      dispatchState: "dispatched",
    };
  }

  const adapter = getCursorCloudAdapter();
  const result = await adapter.dispatch({
    taskId: task.id,
    agentId: task.assignee,
    projectSlug: task.projectSlug,
    title: task.title,
    description: task.description,
    priority: task.priority,
    contentVersion: currentVersion,
    repositoryUrl: input.repositoryUrl,
    startingRef: env.CLOUD_AGENT_STARTING_REF,
    clientAgentId: adapter.clientAgentIdFromTask(task.id),
    approvalId: approval.id,
  });

  const runRow = await prisma.agentRun.create({
    data: {
      taskId: task.id,
      agentId: task.assignee,
      status: result.ok ? "running" : result.state,
      externalId: result.cursorRunId ?? result.externalId,
      cursorAgentId: result.cursorAgentId,
      cursorRunId: result.cursorRunId,
      cursorStatus: result.ok ? "CREATING" : null,
      githubRepository: input.repositoryUrl,
      message: result.message,
      executionMode: result.mode === "live" ? "live" : "mock",
      approvalId: approval.id,
      idempotencyKey: `cloud:${approval.id}`,
      startedAt: result.ok ? new Date() : null,
      errorMessage: result.ok ? null : result.message,
    },
  });

  await prisma.task.update({
    where: { id: task.id },
    data: {
      dispatchState: result.state,
      status: result.ok ? "in_progress" : task.status,
      startedAt: result.ok ? new Date() : task.startedAt ? new Date(task.startedAt) : null,
      gitBranch: null,
      model: null,
    },
  });

  await writeAudit({
    category: "cloud",
    action: result.ok ? "cloud.run_started" : "cloud.run_start_failed",
    actorKind: "owner",
    targetType: "agent_run",
    targetId: runRow.id,
    summary: result.message,
    metadata: {
      taskId: task.id,
      mode: result.mode,
      cursorAgentId: result.cursorAgentId,
      cursorRunId: result.cursorRunId,
      liveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
      // API key asla metadata'ya yazılmaz
    },
  });

  return {
    ok: result.ok,
    taskId: task.id,
    cursorAgentId: result.cursorAgentId,
    cursorRunId: result.cursorRunId,
    mode: result.mode,
    message: result.message,
    dispatchState: result.state,
  };
}

export async function syncCloudRun(taskId: string): Promise<{
  taskId: string;
  cursorStatus?: string;
  dispatchState: string;
  message: string;
}> {
  const prisma = getPrisma();
  const task = await loadTask(taskId);
  const run = await prisma.agentRun.findFirst({
    where: { taskId, cursorAgentId: { not: null }, cursorRunId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!run?.cursorAgentId || !run.cursorRunId) {
    return {
      taskId,
      dispatchState: task.dispatchState,
      message: "Senkronlanacak Cursor run kaydı yok.",
    };
  }

  const adapter = getCursorCloudAdapter();
  try {
    const synced = await adapter.getRun(run.cursorAgentId, run.cursorRunId);
    if (synced.unknownStatus) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "reconciliation_required",
          message: synced.domain.label,
        },
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { dispatchState: "reconciliation_required" },
      });
      return {
        taskId,
        cursorStatus: synced.run.status,
        dispatchState: "reconciliation_required",
        message: synced.domain.label,
      };
    }

    const branch = synced.run.git?.branches?.[0];
    const terminal = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(synced.run.status);

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        cursorStatus: synced.run.status,
        status: synced.run.status.toLowerCase(),
        resultSummary: synced.run.result?.slice(0, 4000) ?? run.resultSummary,
        branch: branch?.branch ?? run.branch,
        prUrl: branch?.prUrl ?? run.prUrl,
        finishedAt: terminal ? new Date() : null,
        message: synced.domain.label,
      },
    });

    // FINISHED → otomatik done değil; in_review
    await prisma.task.update({
      where: { id: taskId },
      data: {
        dispatchState: synced.domain.dispatchState,
        ...(synced.domain.taskStatus ? { status: synced.domain.taskStatus } : {}),
        gitBranch: branch?.branch ?? undefined,
        gitPrUrl: branch?.prUrl ?? undefined,
        finishedAt: terminal && synced.run.status !== "FINISHED" ? new Date() : undefined,
      },
    });

    // Token kullanımı (destekleniyorsa)
    try {
      const usage = await adapter.getUsage(run.cursorAgentId, run.cursorRunId);
      const u = usage?.totalUsage;
      if (u) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens,
          },
        });
      }
    } catch {
      /* kullanım yoksa sessiz */
    }

    return {
      taskId,
      cursorStatus: synced.run.status,
      dispatchState: synced.domain.dispatchState,
      message: synced.domain.label,
    };
  } catch (error) {
    return {
      taskId,
      dispatchState: task.dispatchState,
      message: safeErrorMessage(error),
    };
  }
}

/** Kill switch: aktif run'ları iptal etmeye çalış. */
export async function cancelActiveCloudRunsOnKillSwitch(): Promise<{
  attempted: number;
  cancelled: number;
  unverified: Array<{ runId: string; message: string }>;
}> {
  const prisma = getPrisma();
  const adapter = getCursorCloudAdapter();
  const active = await prisma.agentRun.findMany({
    where: { cursorStatus: { in: [...ACTIVE_CURSOR] }, cursorAgentId: { not: null }, cursorRunId: { not: null } },
  });

  let cancelled = 0;
  const unverified: Array<{ runId: string; message: string }> = [];

  for (const run of active) {
    const result = await adapter.cancelRun(run.cursorAgentId!, run.cursorRunId!);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        cursorStatus: result.verified ? "CANCELLED" : run.cursorStatus,
        status: result.verified ? "cancelled" : "cancel_unverified",
        cancelVerified: result.verified,
        finishedAt: result.verified ? new Date() : run.finishedAt,
        message: result.message,
        errorMessage: result.verified ? null : result.message,
      },
    });
    await prisma.task.update({
      where: { id: run.taskId },
      data: {
        dispatchState: result.verified ? "failed" : "reconciliation_required",
        status: result.verified ? "cancelled" : undefined,
      },
    });
    await writeAudit({
      category: "cloud",
      action: result.verified ? "cloud.run_cancelled" : "cloud.run_cancel_unverified",
      actorKind: "system",
      targetType: "agent_run",
      targetId: run.id,
      summary: result.message,
    });
    if (result.verified) cancelled += 1;
    else unverified.push({ runId: run.id, message: result.message });
  }

  return { attempted: active.length, cancelled, unverified };
}
