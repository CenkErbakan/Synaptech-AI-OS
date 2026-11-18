import {
  Phase3NoopExecutor,
  decideApproval,
  effectiveApprovalStatus,
  recordSubjectVersion,
  type ApprovalRequest,
  type Actor,
  type ApprovalType,
  type RiskLevel,
  ApprovalError,
} from "@synaptech/shared";
import { randomUUID } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { killSwitchActive, notFound, validationError } from "../lib/errors.js";
import { mapApproval } from "../lib/mappers.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";

const executor = new Phase3NoopExecutor();

export async function listApprovals(): Promise<Array<ApprovalRequest & { effectiveStatus: string }>> {
  const prisma = getPrisma();
  const rows = await prisma.approval.findMany({
    include: { project: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const now = new Date();
  return rows
    .filter((row) => row.source === "real")
    .map((row) => {
      const mapped = mapApproval(row);
      mapped.projectSlug = row.project.slug;
      const effective = effectiveApprovalStatus(mapped, now);
      return { ...mapped, effectiveStatus: effective };
    });
}

export async function createApproval(input: {
  type: ApprovalType;
  requestedBy: string;
  projectSlug: string;
  taskId?: string;
  title: string;
  description: string;
  changeSummary: string;
  risk: RiskLevel;
  subjectKind: ApprovalRequest["subject"]["kind"];
  subjectRef: string;
  subjectVersion: string;
  expiresAt?: string;
}): Promise<ApprovalRequest> {
  const prisma = getPrisma();
  const project = await prisma.project.findUnique({ where: { slug: input.projectSlug } });
  if (!project) throw validationError("Geçersiz proje.");

  const id = randomUUID();
  const row = await prisma.approval.create({
    data: {
      id,
      source: "real",
      type: input.type,
      requestedBy: input.requestedBy,
      projectId: project.id,
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      changeSummary: input.changeSummary,
      risk: input.risk,
      subjectKind: input.subjectKind,
      subjectRef: input.subjectRef,
      subjectVersion: input.subjectVersion,
      currentVersion: input.subjectVersion,
      status: "pending",
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      events: {
        create: {
          actorKind: "agent",
          type: "created",
          message: "Onay talebi oluşturuldu.",
        },
      },
    },
    include: { project: true },
  });

  await writeAudit({
    category: "approval",
    action: "approval.created",
    actorKind: "agent",
    actorAgent: input.requestedBy,
    targetType: "approval",
    targetId: id,
    summary: `Onay talebi: ${input.title}`,
  });

  const mapped = mapApproval(row);
  mapped.projectSlug = project.slug;
  return mapped;
}

export async function decideRealApproval(
  id: string,
  decision: "approved" | "rejected",
  actor: Actor,
  note?: string,
): Promise<ApprovalRequest & { effectiveStatus: string; execution?: { executed: boolean; message: string } }> {
  const prisma = getPrisma();
  const kill = await getKillSwitch();
  const row = await prisma.approval.findUnique({ where: { id }, include: { project: true } });
  if (!row || row.source !== "real") throw notFound("Onay talebi bulunamadı.");

  let request = mapApproval(row);
  request.projectSlug = row.project.slug;

  // Süre dolmuşsa expired işaretle
  const effective = effectiveApprovalStatus(request);
  if (effective === "expired") {
    await prisma.approval.update({ where: { id }, data: { status: "expired" } });
    throw validationError("Onay talebinin süresi dolmuş.");
  }

  let decided: ApprovalRequest;
  try {
    decided = decideApproval(request, decision, {
      actor,
      now: new Date(),
      killSwitchEnabled: kill.enabled,
      note,
    });
  } catch (error) {
    if (error instanceof ApprovalError && error.code === "kill_switch") {
      throw killSwitchActive(error.message);
    }
    if (error instanceof ApprovalError) {
      throw validationError(error.message);
    }
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.approval.update({
      where: { id },
      data: {
        status: decided.status,
        decidedAt: decided.decision ? new Date(decided.decision.at) : null,
        decisionNote: decided.decision?.note,
        boundVersion: decided.decision?.boundVersion,
        decidedById: null,
      },
    });
    await tx.approvalEvent.create({
      data: {
        approvalId: id,
        actorKind: "owner",
        type: decision,
        message: decision === "approved" ? "Kullanıcı onayladı." : "Kullanıcı reddetti.",
      },
    });
  });

  await writeAudit({
    category: "approval",
    action: `approval.${decision}`,
    actorKind: "owner",
    targetType: "approval",
    targetId: id,
    summary: decision === "approved" ? "Onay verildi (yürütme yok)." : "Onay reddedildi.",
  });

  let execution: { executed: boolean; message: string } | undefined;
  if (decision === "approved") {
    const localEscalation = row.subjectKind === "task_escalation" && Boolean(row.taskId);
    if (localEscalation && row.taskId) {
      await prisma.task.update({
        where: { id: row.taskId },
        data: {
          status: "planned",
          dispatchState: "ready",
          workflowPhase: "ready",
          executionPolicy: "AUTO",
          blockedReason: null,
          attempts: 0,
          executionKind: "real_ai_pending",
          finishedAt: null,
        },
      });
      execution = {
        executed: false,
        message:
          "Yerel ajan görevi tekrar kuyruğa alındı. Cloud / GitHub / e-posta başlatılmadı; sonraki timer tick dağıtır.",
      };
    } else if (decided.type === "cloud_agent_run") {
      // Cloud run otomatik başlamaz — Owner ayrıca repository ile execute endpoint'ini çağırır.
      execution = {
        executed: false,
        message:
          "cloud_agent_run onaylandı. Run başlatmak için POST /api/cloud/runs/execute (repositoryUrl zorunlu). Live varsayılan kapalı.",
      };
      if (decided.taskId) {
        await prisma.task.update({
          where: { id: decided.taskId },
          data: { dispatchState: "ready" },
        });
      }
    } else {
      execution = await executor.execute({
        approvalId: id,
        type: decided.type,
        boundVersion: decided.decision!.boundVersion,
        payloadRef: decided.subject.ref,
      });
    }
  }

  return {
    ...decided,
    effectiveStatus: effectiveApprovalStatus(decided),
    execution,
  };
}

export async function bumpApprovalVersion(id: string, version: string): Promise<ApprovalRequest> {
  const prisma = getPrisma();
  const row = await prisma.approval.findUnique({ where: { id }, include: { project: true } });
  if (!row) throw notFound("Onay talebi bulunamadı.");
  let request = mapApproval(row);
  request.projectSlug = row.project.slug;
  request = recordSubjectVersion(request, version);

  const effective = effectiveApprovalStatus(request);
  await prisma.approval.update({
    where: { id },
    data: {
      currentVersion: version,
      status: effective === "invalidated" ? "invalidated" : row.status,
    },
  });
  await prisma.approvalEvent.create({
    data: {
      approvalId: id,
      actorKind: "system",
      type: "version_changed",
      message: `İçerik sürümü değişti: ${version}`,
    },
  });
  return { ...request, projectSlug: row.project.slug };
}
