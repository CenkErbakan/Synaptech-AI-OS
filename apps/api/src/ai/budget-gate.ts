import { getEnv } from "../lib/env.js";
import { getCursorCloudAdapter } from "../cursor/adapter.js";

export interface BudgetGateDecision {
  cloudAutoDispatchAllowed: boolean;
  cloudManualDispatchAllowed: boolean;
  reason: string;
  remainingUsageKnown: false;
  onDemandVerified: boolean;
  liveEnabled: boolean;
  costGateStatus: "blocked" | "manual_only";
}

/**
 * Güvenilir maliyet denetimi yoksa Cloud auto-dispatch KAPALI.
 * Kalan kullanım programatik bilinmiyor (bireysel hesap / Admin API Enterprise).
 * Tahminle otomatik izin VERİLMEZ.
 */
export function evaluateCloudBudgetGate(): BudgetGateDecision {
  const env = getEnv();
  const adapter = getCursorCloudAdapter();
  const status = adapter.getStatus();

  const base = {
    remainingUsageKnown: false as const,
    onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
    liveEnabled: env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE === "live",
  };

  if (!base.liveEnabled) {
    return {
      ...base,
      cloudAutoDispatchAllowed: false,
      cloudManualDispatchAllowed: false,
      reason: "cloud_live_disabled",
      costGateStatus: "blocked",
    };
  }

  if (!env.CLOUD_ON_DEMAND_VERIFIED) {
    return {
      ...base,
      cloudAutoDispatchAllowed: false,
      cloudManualDispatchAllowed: false,
      reason: "on_demand_not_verified",
      costGateStatus: "blocked",
    };
  }

  // measured_usage yok + remainingUsageKnown false → auto asla
  if (!status.remainingUsageKnown) {
    return {
      ...base,
      cloudAutoDispatchAllowed: false,
      cloudManualDispatchAllowed: false, // Faz 5E: onay+limit olmadan bile manuel live create kapalı tutulur (Owner pilot onayı ayrı)
      reason: "remaining_usage_unknown_no_auto_no_unguarded_start",
      costGateStatus: "blocked",
    };
  }

  return {
    ...base,
    cloudAutoDispatchAllowed: false,
    cloudManualDispatchAllowed: false,
    reason: "unreachable_safe_default",
    costGateStatus: "blocked",
  };
}

/** Cloud Agent create öncesi zorunlu kontrol — limit/onay yoksa reddet. */
export function assertCloudCreateAllowed(opts: {
  hasOwnerApproval: boolean;
  approvalType?: string;
}): { ok: true } | { ok: false; reason: string } {
  const gate = evaluateCloudBudgetGate();
  if (!opts.hasOwnerApproval || opts.approvalType !== "cloud_agent_run") {
    return { ok: false, reason: "missing_cloud_agent_run_approval" };
  }
  if (!gate.liveEnabled) {
    return { ok: false, reason: gate.reason };
  }
  if (!gate.onDemandVerified) {
    return { ok: false, reason: "on_demand_not_verified" };
  }
  // Kalan kullanım bilinmiyor → create yok (tahmin yok)
  return { ok: false, reason: "cost_gate_blocks_unguarded_cloud_create" };
}
