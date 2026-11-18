import { z } from "zod";

import { AgentIdSchema } from "./agents";
import { DataSourceSchema } from "./source";
import type { Actor } from "./tasks";

export const APPROVAL_TYPES = [
  "protected_branch_merge",
  "production_deploy",
  "db_migration",
  "blog_publish",
  "ad_campaign_launch",
  "ad_budget_change",
  "customer_message",
  "cloud_agent_run",
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export const ApprovalTypeSchema = z.enum(APPROVAL_TYPES);

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  protected_branch_merge: "Korumalı branch merge",
  production_deploy: "Production deploy",
  db_migration: "Veritabanı migration",
  blog_publish: "Blog yayını",
  ad_campaign_launch: "Reklam kampanyası başlatma",
  ad_budget_change: "Reklam bütçesi değişikliği",
  customer_message: "Müşteriye ileti gönderme",
  cloud_agent_run: "Cursor Cloud Agent çalıştırma",
};

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RiskLevelSchema = z.enum(RISK_LEVELS);

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "invalidated", "executed"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type EffectiveApprovalStatus = ApprovalStatus;

export const EFFECTIVE_APPROVAL_STATUS_LABELS: Record<EffectiveApprovalStatus, string> = {
  pending: "Onay bekliyor",
  approved: "Onaylandı · Güvenilir yürütücü bekleniyor",
  rejected: "Reddedildi",
  expired: "Süresi doldu",
  invalidated: "Geçersiz · Sürüm değişti",
  executed: "Yürütüldü",
};

export const ApprovalSubjectSchema = z.object({
  kind: z.enum(["git_commit", "content_sha256", "payload_sha256"]),
  ref: z.string().min(1),
  version: z.string().min(1),
});

export type ApprovalSubject = z.infer<typeof ApprovalSubjectSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  source: DataSourceSchema,
  type: ApprovalTypeSchema,
  requestedBy: AgentIdSchema,
  projectSlug: z.string().min(1),
  taskId: z.string().optional(),
  title: z.string().min(1),
  description: z.string(),
  changeSummary: z.string(),
  risk: RiskLevelSchema,
  subject: ApprovalSubjectSchema,
  currentVersion: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected", "executed"]),
  decision: z
    .object({
      by: z.literal("user"),
      at: z.string(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().optional(),
      boundVersion: z.string(),
    })
    .optional(),
  createdAt: z.string().min(1),
  expiresAt: z.string().optional(),
  executor: z.literal("trusted-executor"),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export type ApprovalErrorCode = "forbidden_actor" | "not_pending" | "version_mismatch" | "kill_switch";

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

/** Onay, talep edilen sürüme bağlanır; bağlanan sürüm değişirse onay geçersiz sayılır. */
export function decideApproval(
  request: ApprovalRequest,
  decision: "approved" | "rejected",
  ctx: { actor: Actor; now: Date; killSwitchEnabled: boolean; note?: string },
): ApprovalRequest {
  if (ctx.actor.kind !== "user") {
    throw new ApprovalError("forbidden_actor", "Onayı yalnızca kullanıcı verebilir veya reddedebilir.");
  }
  if (request.status !== "pending") {
    throw new ApprovalError("not_pending", "Bu talep artık karar beklemiyor.");
  }
  if (decision === "approved") {
    if (ctx.killSwitchEnabled) {
      throw new ApprovalError("kill_switch", "Kill switch açık: onay verilemez.");
    }
    if (request.currentVersion !== request.subject.version) {
      throw new ApprovalError(
        "version_mismatch",
        "Değişiklik onay talebinden sonra güncellendi; yeni sürüm için yeni onay talebi gerekir.",
      );
    }
  }
  return {
    ...request,
    status: decision,
    decision: {
      by: "user",
      at: ctx.now.toISOString(),
      decision,
      note: ctx.note,
      boundVersion: request.subject.version,
    },
  };
}

export function effectiveApprovalStatus(
  request: ApprovalRequest,
  now: Date = new Date(),
): EffectiveApprovalStatus {
  if (
    request.status === "approved" &&
    request.decision &&
    request.currentVersion !== request.decision.boundVersion
  ) {
    return "invalidated";
  }
  if (
    request.status === "pending" &&
    request.expiresAt &&
    now.getTime() > new Date(request.expiresAt).getTime()
  ) {
    return "expired";
  }
  return request.status;
}

export function isApprovalValidFor(request: ApprovalRequest, version: string): boolean {
  return (
    effectiveApprovalStatus(request) === "approved" && request.decision?.boundVersion === version
  );
}

export function recordSubjectVersion(request: ApprovalRequest, version: string): ApprovalRequest {
  return { ...request, currentVersion: version };
}

export function shortVersion(version: string): string {
  const [prefix, value] = version.includes(":") ? version.split(":", 2) : ["", version];
  const short = (value ?? "").slice(0, 10);
  return prefix ? `${prefix}:${short}` : short;
}
