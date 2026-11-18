/**
 * Owner onaylı tam operasyon sıfırlaması — sınıflandırma ve FK sırası.
 * AuditLog / User / Agent / Project / Goal / grant / kill-switch silinmez.
 */

export const PRISMA_TABLES = [
  "User",
  "Agent",
  "Project",
  "Task",
  "TaskEvent",
  "TaskAssignment",
  "Approval",
  "ApprovalEvent",
  "AgentRun",
  "CompanyGoal",
  "Opportunity",
  "AutonomyPolicy",
  "ScheduledJob",
  "ScheduledJobRun",
  "AgentMessage",
  "AuditLog",
  "SystemSetting",
  "IntegrationConnection",
  "Lead",
  "SeoFinding",
  "ContentDraftRecord",
  "AdProposal",
  "GrowthScanRun",
  "WorkerLease",
  "WorkerInstance",
] as const;

export type PrismaTable = (typeof PRISMA_TABLES)[number];

/** Fiziksel silinecek operasyon tabloları (Owner listesi + zorunlu FK çocukları). */
export const DELETE_TABLES: PrismaTable[] = [
  "AgentMessage",
  "TaskEvent",
  "TaskAssignment",
  "AgentRun",
  "ApprovalEvent",
  "Approval",
  "Task",
  "Opportunity",
  "Lead",
  "ScheduledJobRun",
  "WorkerLease",
];

/** Dashboard'da eski faz işi gibi duran büyüme artıkları — Owner listesinde yok; dry-run'da raporlanır, silinmez. */
export const UNLISTED_OPERATIONAL_TABLES: PrismaTable[] = [
  "SeoFinding",
  "ContentDraftRecord",
  "AdProposal",
  "GrowthScanRun",
];

export const PRESERVE_TABLES: PrismaTable[] = [
  "User",
  "Agent",
  "Project",
  "CompanyGoal",
  "AutonomyPolicy",
  "ScheduledJob",
  "AuditLog",
  "SystemSetting",
  "IntegrationConnection",
  "WorkerInstance",
];

export const PRESERVE_SETTING_KEYS = new Set([
  "kill_switch",
  "owner_capability_grants",
]);

export const RESET_SETTING_KEYS = [
  "operation_epoch",
  "deferred_llm_queue",
  "ceo_event_pending",
  "ceo_provider_circuit",
  "controlled_autonomy_window",
] as const;

export const CUSTOMER_LEAD_SOURCE = /customer|inbound|sales|contract|paid|fatura|musteri|müşteri/i;
export const TEST_LEAD_SOURCE =
  /public|self|test|demo|pilot|faz5|research|chamber|ebso|website|scan|synthetic|fixture/i;

export type CrmClass = "delete_test_or_self" | "preserve_customer" | "blocked_unknown";

export function classifyLeadRow(row: {
  sourceKind: string;
  status: string;
  companyName: string;
  notes?: string | null;
}): CrmClass {
  const blob = `${row.sourceKind} ${row.status} ${row.notes ?? ""}`;
  if (CUSTOMER_LEAD_SOURCE.test(blob) && !TEST_LEAD_SOURCE.test(row.sourceKind)) {
    return "preserve_customer";
  }
  if (TEST_LEAD_SOURCE.test(row.sourceKind) || TEST_LEAD_SOURCE.test(row.status)) {
    return "delete_test_or_self";
  }
  if (/new|open|researched|disqualified|unqualified/i.test(row.status)) {
    return "delete_test_or_self";
  }
  return "blocked_unknown";
}

export function classifyOpportunityRow(row: { sourceKind: string; title: string }): CrmClass {
  const blob = `${row.sourceKind} ${row.title}`;
  if (CUSTOMER_LEAD_SOURCE.test(blob) && !TEST_LEAD_SOURCE.test(row.sourceKind)) {
    return "preserve_customer";
  }
  return "delete_test_or_self";
}

export function unexpectedDboTables(dboNames: string[]): string[] {
  const known = new Set<string>([
    ...PRISMA_TABLES,
    "_prisma_migrations",
    "sysdiagrams",
  ]);
  return dboNames.filter((name) => !known.has(name));
}

export function buildNewEpoch(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return {
    id: `ops-${day}-clean`,
    startedAt: now.toISOString(),
    previousId: null as string | null,
    note: "Owner tam operasyon sıfırlaması. Eski Task/Approval/Message aktarılmadı.",
  };
}
