import "server-only";

import type { SystemSnapshot } from "@/lib/types";

import { loadActiveSubagents, loadAuditEvents } from "./audit";
import { apiFetch } from "./api-client";
import { loadGuardStatus, loadKillSwitch, loadSystemStatus } from "./config";

const DEFAULT_SLOT_TTL_MINUTES = 30;

/** Yalnızca gerçek kaynaklardan oluşur; DEMO verisi bu yanıttan hiç geçmez. */
export async function buildSystemSnapshot(now: Date): Promise<SystemSnapshot> {
  const [systemStatus, fileKill, guard, audit, apiKill] = await Promise.all([
    loadSystemStatus(),
    loadKillSwitch(),
    loadGuardStatus(),
    loadAuditEvents({ limit: 300 }),
    apiFetch<{
      operationalEnabled: boolean;
      conflict: boolean;
      dbEnabled: boolean | null;
      fileEnabled: boolean | null;
      authority: string;
      killSwitch: {
        enabled: boolean;
        reason: string | null;
        changedBy: string | null;
        changedAt: string | null;
      };
    }>("/api/system/kill-switch").catch(() => null),
  ]);

  const fileEnabled = fileKill.ok ? fileKill.data.enabled : false;
  const operationalEnabled = apiKill
    ? Boolean(apiKill.operationalEnabled)
    : fileKill.ok
      ? fileKill.data.enabled
      : true;
  const conflict = apiKill?.conflict === true || (apiKill != null && apiKill.fileEnabled !== apiKill.dbEnabled);
  const killSwitch = fileKill.ok
    ? {
        ok: true as const,
        path: apiKill ? "api:/api/system/kill-switch + config/kill-switch.json" : fileKill.path,
        data: {
          ...fileKill.data,
          enabled: operationalEnabled,
          reason: conflict
            ? `Kaynak çelişkisi (DB=${String(apiKill?.dbEnabled)}, dosya=${String(fileEnabled)}); fail-safe AÇIK. Otonomi kapalı.`
            : (apiKill?.killSwitch.reason ?? fileKill.data.reason),
          conflict,
          dbEnabled: apiKill?.dbEnabled ?? null,
          fileEnabled: apiKill?.fileEnabled ?? fileEnabled,
          authority: apiKill?.authority ?? "file",
        },
      }
    : apiKill
      ? {
          ok: true as const,
          path: "api:/api/system/kill-switch",
          data: {
            enabled: operationalEnabled,
            reason: apiKill.killSwitch.reason,
            changedBy: apiKill.killSwitch.changedBy,
            changedAt: apiKill.killSwitch.changedAt,
            conflict,
            dbEnabled: apiKill.dbEnabled,
            fileEnabled: apiKill.fileEnabled,
            authority: apiKill.authority,
          },
        }
      : fileKill;

  const subagents = await loadActiveSubagents(
    guard.policy?.subagents.slotTtlMinutes ?? DEFAULT_SLOT_TTL_MINUTES,
    now,
  );

  return {
    generatedAt: now.toISOString(),
    systemStatus,
    killSwitch,
    guard,
    activeSubagents: subagents.active,
    subagentStateError: subagents.error,
    audit,
  };
}
