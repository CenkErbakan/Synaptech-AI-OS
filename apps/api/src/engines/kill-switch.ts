import fs from "node:fs/promises";
import path from "node:path";

import { getPrisma } from "../db/prisma.js";
import { repoRoot } from "../lib/env.js";
import { getEnv } from "../lib/env.js";
import { forbidden } from "../lib/errors.js";
import type { AuthPrincipal } from "../auth/context.js";
import { writeAudit } from "./audit.js";

const KEY = "kill_switch";

export interface KillSwitchState {
  enabled: boolean;
  reason: string | null;
  changedBy: string | null;
  changedAt: string | null;
  source: "database" | "file" | "default" | "fail_safe_or";
}

export type KillSwitchResolved = KillSwitchState & {
  conflict: boolean;
  dbEnabled: boolean | null;
  fileEnabled: boolean | null;
};

/** DB veya dosyadan biri açıksa otonomi kapalı (fail-safe OR). */
export function mergeKillSwitchSources(
  db: Omit<KillSwitchState, "source"> | null,
  file: Omit<KillSwitchState, "source"> | null,
): KillSwitchResolved {
  const dbEnabled = db ? Boolean(db.enabled) : null;
  const fileEnabled = file ? Boolean(file.enabled) : null;
  const conflict = dbEnabled !== null && fileEnabled !== null && dbEnabled !== fileEnabled;
  const failSafeEnabled = Boolean(dbEnabled) || Boolean(fileEnabled);
  const primary = dbEnabled ? db : fileEnabled ? file : db ?? file;
  return {
    enabled: failSafeEnabled,
    reason: conflict
      ? `Kaynak çelişkisi (DB=${dbEnabled}, dosya=${fileEnabled}); fail-safe AÇIK.`
      : (primary?.reason ?? null),
    changedBy: primary?.changedBy ?? null,
    changedAt: primary?.changedAt ?? null,
    source: conflict ? "fail_safe_or" : db ? "database" : file ? "file" : "default",
    conflict,
    dbEnabled,
    fileEnabled,
  };
}

async function readFileMirror(): Promise<KillSwitchState | null> {
  const env = getEnv();
  const filePath = path.isAbsolute(env.KILL_SWITCH_FILE)
    ? env.KILL_SWITCH_FILE
    : path.join(repoRoot(), env.KILL_SWITCH_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw) as {
      enabled?: boolean;
      reason?: string | null;
      changedBy?: string | null;
      changedAt?: string | null;
    };
    return {
      enabled: Boolean(json.enabled),
      reason: json.reason ?? null,
      changedBy: json.changedBy ?? null,
      changedAt: json.changedAt ?? null,
      source: "file",
    };
  } catch {
    return null;
  }
}

async function writeFileMirror(state: Omit<KillSwitchState, "source">): Promise<void> {
  const env = getEnv();
  if (env.KILL_SWITCH_SKIP_FILE_MIRROR) {
    return;
  }
  const filePath = path.isAbsolute(env.KILL_SWITCH_FILE)
    ? env.KILL_SWITCH_FILE
    : path.join(repoRoot(), env.KILL_SWITCH_FILE);
  // Korumalı config/kill-switch.json yoluna testlerden yazmayı engelle (Owner dosyası).
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("/config/kill-switch.json") && env.NODE_ENV === "test") {
    return;
  }
  const payload = {
    enabled: state.enabled,
    reason: state.reason,
    changedBy: state.changedBy,
    changedAt: state.changedAt,
    note: "API Owner tarafından senkronlandı. Ajanlar bu dosyayı yazmaz.",
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function getKillSwitch(): Promise<KillSwitchResolved> {
  const prisma = getPrisma();
  let db: Omit<KillSwitchState, "source"> | null = null;
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as Omit<KillSwitchState, "source">;
      db = {
        enabled: Boolean(parsed.enabled),
        reason: parsed.reason ?? null,
        changedBy: parsed.changedBy ?? null,
        changedAt: parsed.changedAt ?? null,
      };
    } catch {
      db = null;
    }
  }
  const file = await readFileMirror();
  const filePlain = file
    ? {
        enabled: file.enabled,
        reason: file.reason,
        changedBy: file.changedBy,
        changedAt: file.changedAt,
      }
    : null;
  return mergeKillSwitchSources(db, filePlain);
}

export async function setKillSwitch(
  principal: AuthPrincipal,
  input: { enabled: boolean; reason?: string | null },
): Promise<KillSwitchState> {
  if (principal.kind !== "owner") {
    throw forbidden("Kill switch yalnızca Owner tarafından değiştirilebilir.");
  }
  const now = new Date().toISOString();
  const next: Omit<KillSwitchState, "source"> = {
    enabled: input.enabled,
    reason: input.reason ?? null,
    changedBy: principal.displayName,
    changedAt: now,
  };
  const prisma = getPrisma();
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next), updatedBy: principal.displayName },
    update: { value: JSON.stringify(next), updatedBy: principal.displayName },
  });
  try {
    await writeFileMirror(next);
  } catch (error) {
    // Hook dosyası yazılamazsa DB otoritesi kalır; audit'e not düşülür.
    await writeAudit({
      category: "security",
      action: "kill_switch.file_sync_failed",
      actorKind: "owner",
      summary: "Kill switch DB'ye yazıldı; dosya senkronu başarısız.",
      metadata: { error: error instanceof Error ? error.message : "unknown" },
    });
  }
  await writeAudit({
    category: "security",
    action: input.enabled ? "kill_switch.enabled" : "kill_switch.disabled",
    actorKind: "owner",
    summary: input.enabled ? "Kill switch açıldı." : "Kill switch kapatıldı.",
    metadata: { reason: next.reason },
  });

  let cancelSummary: { attempted: number; cancelled: number; unverified: Array<{ runId: string; message: string }> } | undefined;
  if (input.enabled) {
    const { cancelActiveCloudRunsOnKillSwitch } = await import("./cloud-dispatch.js");
    cancelSummary = await cancelActiveCloudRunsOnKillSwitch();
    await writeAudit({
      category: "cloud",
      action: "cloud.kill_switch_cancel_sweep",
      actorKind: "owner",
      summary: `Aktif Cloud run iptal taraması: denenen=${cancelSummary.attempted}, iptal=${cancelSummary.cancelled}, doğrulanamayan=${cancelSummary.unverified.length}`,
      metadata: { unverified: cancelSummary.unverified },
    });
  }

  return { ...next, source: "database", ...(cancelSummary ? { cloudCancel: cancelSummary } : {}) } as KillSwitchState & {
    cloudCancel?: typeof cancelSummary;
  };
}
