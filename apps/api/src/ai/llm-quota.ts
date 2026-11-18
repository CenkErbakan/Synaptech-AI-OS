/**
 * Canonical günlük LLM kota muhasebesi.
 * Audit satırı ≠ model çağrısı. Mock gerçek kotayı tüketmez.
 * Geçmiş kayıtlar silinmez; yeni kayıtlar quotaCallId ile tekilleştirilir.
 */

export const QUOTA_POLICY = {
  /** Gerçek kota: yalnızca ilgili sağlayıcıya giden local LLM çağrısı. */
  realBilledWhen: "providerInvoked && realAiExecution (legacy: realAiExecution===true)",
  /** Sağlayıcıya gidip JSON/acceptance fail: gerçek kota tüketilir. */
  failedRealCalls: "count_if_provider_invoked",
  /** Probe/lease/kill/idempotent skip: kotaya yazılmaz. */
  notBilled: ["probe_only", "lease_blocked", "kill_switch", "idempotent_skip", "mode_off"],
  mockConsumesReal: false,
  dedupe: "quotaCallId then audit row id",
  timezone: "UTC",
} as const;

export type QuotaKind = "scheduler_ceo" | "agent";

export type QuotaAuditRow = {
  id: string;
  action: string;
  actorAgent: string | null;
  metadata: string | null;
};

export type ParsedQuotaEvent = {
  id: string;
  quotaCallId: string;
  kind: QuotaKind | null;
  realBilled: boolean;
  mockBilled: boolean;
  providerInvoked: boolean;
  realAiExecution: boolean;
  agentId: string | null;
};

export function utcDayBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function nextUtcDayStart(now = new Date()): Date {
  return utcDayBounds(now).end;
}

function parseMeta(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const v = JSON.parse(metadata) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Legacy hata: meta.mode==="local" gerçek AI sayılmaz.
 * Yalnızca realAiExecution===true veya açık providerInvoked+real.
 */
export function parseQuotaEvent(row: QuotaAuditRow): ParsedQuotaEvent {
  const meta = parseMeta(row.metadata);
  const realAiExecution = meta.realAiExecution === true;
  const providerInvoked =
    meta.providerInvoked === true ||
    realAiExecution ||
    (typeof meta.modelId === "string" && meta.modelId.startsWith("qwen"));

  let kind: QuotaKind | null = null;
  if (row.action === "ai.scheduler_ceo_cycle") kind = "scheduler_ceo";
  else if (row.action === "ai.local_agent_execution") kind = "agent";
  // ai.local_ceo_pilot ayrı manuel pilot — scheduler CEO kotasına ve ajan kotasına karışmaz.

  const quotaCallId =
    typeof meta.quotaCallId === "string" && meta.quotaCallId.length > 0
      ? meta.quotaCallId
      : row.id;

  const billedExplicit = meta.quotaBilled;
  const realBilled =
    kind !== null &&
    (billedExplicit === true
      ? realAiExecution
      : billedExplicit === false
        ? false
        : realAiExecution);
  const mockBilled =
    kind !== null &&
    !realBilled &&
    (billedExplicit === true
      ? true
      : billedExplicit === false
        ? false
        : row.action === "ai.scheduler_ceo_cycle" || row.action === "ai.local_agent_execution");

  return {
    id: row.id,
    quotaCallId,
    kind,
    realBilled,
    mockBilled,
    providerInvoked,
    realAiExecution,
    agentId: row.actorAgent,
  };
}

export function uniqueBilled(
  events: ParsedQuotaEvent[],
  filter: (e: ParsedQuotaEvent) => boolean,
): number {
  const seen = new Set<string>();
  for (const e of events) {
    if (!filter(e)) continue;
    if (seen.has(e.quotaCallId)) continue;
    seen.add(e.quotaCallId);
  }
  return seen.size;
}

export function countQuotaFromRows(rows: QuotaAuditRow[]): {
  ceoReal: number;
  ceoMock: number;
  agentReal: number;
  agentMock: number;
  perAgentReal: Record<string, number>;
  perAgentMock: Record<string, number>;
} {
  const events = rows.map(parseQuotaEvent);
  const ceoReal = uniqueBilled(events, (e) => e.kind === "scheduler_ceo" && e.realBilled);
  const ceoMock = uniqueBilled(events, (e) => e.kind === "scheduler_ceo" && e.mockBilled);
  const agentReal = uniqueBilled(events, (e) => e.kind === "agent" && e.realBilled);
  const agentMock = uniqueBilled(events, (e) => e.kind === "agent" && e.mockBilled);
  const perAgentReal: Record<string, number> = {};
  const perAgentMock: Record<string, number> = {};
  const byAgent = new Map<string, ParsedQuotaEvent[]>();
  for (const e of events) {
    if (e.kind !== "agent" || !e.agentId) continue;
    const list = byAgent.get(e.agentId) ?? [];
    list.push(e);
    byAgent.set(e.agentId, list);
  }
  for (const [id, list] of byAgent) {
    perAgentReal[id] = uniqueBilled(list, (e) => e.realBilled);
    perAgentMock[id] = uniqueBilled(list, (e) => e.mockBilled);
  }
  return { ceoReal, ceoMock, agentReal, agentMock, perAgentReal, perAgentMock };
}

export function budgetResult(
  used: number,
  max: number,
  reason: string,
  now: Date,
): { ok: boolean; used: number; max: number; reason?: string; nextEligibleAt: string } {
  const nextEligibleAt = nextUtcDayStart(now).toISOString();
  if (used >= max) {
    return { ok: false, used, max, reason, nextEligibleAt };
  }
  return { ok: true, used, max, nextEligibleAt };
}

export function buildQuotaAuditMeta(input: {
  quotaCallId: string;
  quotaKind: QuotaKind;
  realAiExecution: boolean;
  providerInvoked: boolean;
  mode: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    quotaCallId: input.quotaCallId,
    quotaKind: input.quotaKind,
    quotaBilled: input.providerInvoked,
    providerInvoked: input.providerInvoked,
    realAiExecution: input.realAiExecution,
    mode: input.mode,
    ...input.extra,
  };
}
