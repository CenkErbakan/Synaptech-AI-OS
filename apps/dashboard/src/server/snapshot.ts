import "server-only";

import type { SystemSnapshot } from "@/lib/types";

import { loadActiveSubagents, loadAuditEvents } from "./audit";
import { loadGuardStatus, loadKillSwitch, loadSystemStatus } from "./config";

const DEFAULT_SLOT_TTL_MINUTES = 30;

/** Yalnızca gerçek kaynaklardan oluşur; DEMO verisi bu yanıttan hiç geçmez. */
export async function buildSystemSnapshot(now: Date): Promise<SystemSnapshot> {
  const [systemStatus, killSwitch, guard, audit] = await Promise.all([
    loadSystemStatus(),
    loadKillSwitch(),
    loadGuardStatus(),
    loadAuditEvents({ limit: 300 }),
  ]);

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
