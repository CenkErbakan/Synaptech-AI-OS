import { getPrisma } from "../db/prisma.js";
import { getEnv } from "../lib/env.js";
import { killSwitchActive } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";
import { countActiveLiveCloudRuns } from "./cloud-dispatch.js";

export type Authority = "AUTO" | "POLICY-AUTO" | "OWNER-APPROVAL";

export interface DispatchDecision {
  taskId: string;
  authority: Authority;
  allowed: boolean;
  reason: string;
  cloudAttempted: false;
}

/**
 * Otonom dispatch — Faz 5A: Cloud create YOK.
 * AUTO: görev planned kalır / not_applicable→ready benzeri yerel durum.
 * POLICY-AUTO Cloud: bütçe doğrulanamazsa ve live kapalıysa reddedilir.
 */
export async function evaluateAndDispatchAutonomous(taskId: string): Promise<DispatchDecision> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const prisma = getPrisma();
  const env = getEnv();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task || task.source !== "real") {
    return { taskId, authority: "OWNER-APPROVAL", allowed: false, reason: "task_not_found", cloudAttempted: false };
  }

  const policyKey = task.executionPolicy ?? "AUTO";
  const authority = (["AUTO", "POLICY-AUTO", "OWNER-APPROVAL"].includes(policyKey)
    ? policyKey
    : "OWNER-APPROVAL") as Authority;

  if (authority === "OWNER-APPROVAL") {
    return {
      taskId,
      authority,
      allowed: false,
      reason: "owner_approval_required",
      cloudAttempted: false,
    };
  }

  if (authority === "POLICY-AUTO") {
    // Faz 5E: güvenilir maliyet denetimi yoksa Cloud auto-dispatch kapalı (tahminle izin yok)
    const { evaluateCloudBudgetGate } = await import("../ai/budget-gate.js");
    const gate = evaluateCloudBudgetGate();
    if (!gate.cloudAutoDispatchAllowed) {
      await writeAudit({
        category: "autonomy",
        action: "dispatch.policy_auto_blocked",
        actorKind: "system",
        targetType: "task",
        targetId: taskId,
        summary: `POLICY-AUTO Cloud engellendi: ${gate.reason}`,
        metadata: { costGateStatus: gate.costGateStatus, remainingUsageKnown: false },
      });
      return {
        taskId,
        authority,
        allowed: false,
        reason: gate.reason,
        cloudAttempted: false,
      };
    }
    if (!env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE !== "live") {
      return {
        taskId,
        authority,
        allowed: false,
        reason: "cloud_live_disabled",
        cloudAttempted: false,
      };
    }
    if (!env.CLOUD_ON_DEMAND_VERIFIED) {
      return {
        taskId,
        authority,
        allowed: false,
        reason: "on_demand_not_verified",
        cloudAttempted: false,
      };
    }
    const live = await countActiveLiveCloudRuns();
    if (live >= 1) {
      return {
        taskId,
        authority,
        allowed: false,
        reason: "live_capacity_full",
        cloudAttempted: false,
      };
    }
    // Live path Faz 5A'da bilinçli olarak uygulanmaz
    return {
      taskId,
      authority,
      allowed: false,
      reason: "faz5a_no_live_cloud_dispatch",
      cloudAttempted: false,
    };
  }

  // Faz 5B: bağımlılık bekleyen zincir adımları hazır sayılmaz
  if (task.workflowPhase === "waiting_dependency") {
    return {
      taskId,
      authority: "AUTO",
      allowed: false,
      reason: "waiting_dependency",
      cloudAttempted: false,
    };
  }

  // AUTO: yerel planlama tamam — Cloud yok
  await prisma.task.update({
    where: { id: taskId },
    data: { dispatchState: "ready" },
  });
  await writeAudit({
    category: "autonomy",
    action: "dispatch.auto_ready",
    actorKind: "system",
    targetType: "task",
    targetId: taskId,
    summary: "AUTO görev dispatchState=ready (Cloud create yok).",
    metadata: { authority: "AUTO", cloudAttempted: false },
  });

  return {
    taskId,
    authority: "AUTO",
    allowed: true,
    reason: "auto_local_ready",
    cloudAttempted: false,
  };
}

export async function dispatchAutonomousChildren(parentTaskId: string): Promise<DispatchDecision[]> {
  const prisma = getPrisma();
  const children = await prisma.task.findMany({
    where: { parentTaskId, source: "real", archivedAt: null },
  });
  const out: DispatchDecision[] = [];
  for (const child of children) {
    out.push(await evaluateAndDispatchAutonomous(child.id));
  }
  return out;
}
