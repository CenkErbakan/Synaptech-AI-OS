import { z } from "zod";

/** Kullanıcının Cursor ayarlarından bakıp elle girdiği kullanım değerleri; tahmin değildir. */
export const ManualUsageEntrySchema = z.object({
  id: z.string().min(1),
  source: z.literal("manual"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı."),
  cursorModelsPercent: z.number().min(0).max(100).nullable(),
  otherModelsPercent: z.number().min(0).max(100).nullable(),
  note: z.string().max(280).default(""),
  createdAt: z.string().min(1),
});

export type ManualUsageEntry = z.infer<typeof ManualUsageEntrySchema>;

export interface UsageAlert {
  level: "warning" | "critical";
  pool: "cursor_models" | "other_models";
  message: string;
  entryId: string;
}

const POOL_LABELS = {
  cursor_models: "Cursor Models",
  other_models: "Other Models",
} as const;

export function evaluateUsageAlerts(
  entries: readonly ManualUsageEntry[],
  thresholds: { warning: number; critical: number },
): UsageAlert[] {
  const latest = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return [];

  const alerts: UsageAlert[] = [];
  const pools = [
    ["cursor_models", latest.cursorModelsPercent],
    ["other_models", latest.otherModelsPercent],
  ] as const;

  for (const [pool, value] of pools) {
    if (value === null) continue;
    if (value >= thresholds.critical) {
      alerts.push({
        level: "critical",
        pool,
        entryId: latest.id,
        message: `${POOL_LABELS[pool]} havuzu %${value} (kritik eşik %${thresholds.critical}). On-Demand kapalıysa havuz bitince kullanım durur.`,
      });
    } else if (value >= thresholds.warning) {
      alerts.push({
        level: "warning",
        pool,
        entryId: latest.id,
        message: `${POOL_LABELS[pool]} havuzu %${value} (uyarı eşiği %${thresholds.warning}).`,
      });
    }
  }
  return alerts;
}
