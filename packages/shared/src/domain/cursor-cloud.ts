import { z } from "zod";

import type { DispatchState, TaskStatus } from "./tasks";

/** Cursor Cloud Agents API v1 — resmi run durumları (uydurma yok). */
export const CURSOR_RUN_STATUSES = [
  "CREATING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
] as const;

export type CursorRunStatus = (typeof CURSOR_RUN_STATUSES)[number];
export const CursorRunStatusSchema = z.enum(CURSOR_RUN_STATUSES);

export const CURSOR_AGENT_STATUSES = ["ACTIVE", "IDLE", "ARCHIVED"] as const;
export type CursorAgentStatus = (typeof CURSOR_AGENT_STATUSES)[number];

export const CURSOR_RUN_STATUS_LABELS: Record<CursorRunStatus, string> = {
  CREATING: "Başlatılıyor",
  RUNNING: "Çalışıyor",
  WAITING_FOR_BACKGROUND_WORK: "Arka plan işi bekleniyor",
  FINISHED: "Cursor run tamamlandı",
  ERROR: "Başarısız",
  CANCELLED: "İptal edildi",
  EXPIRED: "Süresi doldu",
};

export function isActiveCursorRun(status: CursorRunStatus): boolean {
  return status === "CREATING" || status === "RUNNING" || status === "WAITING_FOR_BACKGROUND_WORK";
}

export function isTerminalCursorRun(status: CursorRunStatus): boolean {
  return status === "FINISHED" || status === "ERROR" || status === "CANCELLED" || status === "EXPIRED";
}

/**
 * Cursor run → SynapTech domain eşlemesi.
 * FINISHED otomatik "done" değildir; çıktı doğrulanana kadar in_review.
 */
export function mapCursorRunToDomain(status: CursorRunStatus): {
  taskStatus?: TaskStatus;
  dispatchState: DispatchState;
  label: string;
} {
  switch (status) {
    case "CREATING":
      return { taskStatus: "in_progress", dispatchState: "dispatched", label: CURSOR_RUN_STATUS_LABELS.CREATING };
    case "RUNNING":
    case "WAITING_FOR_BACKGROUND_WORK":
      return { taskStatus: "in_progress", dispatchState: "dispatched", label: CURSOR_RUN_STATUS_LABELS[status] };
    case "FINISHED":
      return { taskStatus: "in_review", dispatchState: "ready", label: CURSOR_RUN_STATUS_LABELS.FINISHED };
    case "ERROR":
    case "EXPIRED":
      return { taskStatus: "failed", dispatchState: "failed", label: CURSOR_RUN_STATUS_LABELS[status] };
    case "CANCELLED":
      return { taskStatus: "cancelled", dispatchState: "failed", label: CURSOR_RUN_STATUS_LABELS.CANCELLED };
  }
}

export const CloudConnectionStatusSchema = z.enum([
  "not_configured",
  "configured_disabled",
  "mock",
  "live_enabled",
  "error",
]);

export type CloudConnectionStatus = z.infer<typeof CloudConnectionStatusSchema>;

export const CloudExecutionPolicySchema = z.object({
  liveEnabled: z.boolean(),
  maxConcurrentRuns: z.literal(1),
  autoRetry: z.literal(false),
  onDemandVerified: z.boolean(),
  remainingUsageKnown: z.boolean(),
});

export type CloudExecutionPolicy = z.infer<typeof CloudExecutionPolicySchema>;
