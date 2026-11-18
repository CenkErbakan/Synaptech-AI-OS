import { z } from "zod";

import { AGENT_IDS, type AgentId } from "./agents";

/** Ajan yetenekleri — model önerisi ≠ gerçek araç eylemi. */
export const AGENT_CAPABILITY_KINDS = [
  "llm_plan",
  "llm_analysis",
  "repo_read",
  "sandbox_patch",
  "sandbox_test",
  "research",
  "seo",
  "content_draft",
  "security_review",
  "ads_draft",
] as const;

export type AgentCapabilityKind = (typeof AGENT_CAPABILITY_KINDS)[number];
export const AgentCapabilityKindSchema = z.enum(AGENT_CAPABILITY_KINDS);

export type AgentCapabilityRow = {
  agentId: AgentId;
  capabilities: AgentCapabilityKind[];
  /** İlk kontrollü otonomi: otomatik çalışabilir mi (yine de env gate gerekir). */
  autoAllowedInControlledMode: boolean;
  /** Owner onayı olmadan yapılamaz. */
  requiresOwnerApprovalActions: string[];
  notes: string;
};

/**
 * Dokuz ajan capability matrix.
 * Cloud/push/PR/merge/deploy/ads spend/blog publish/customer message — her zaman Owner.
 */
export const AGENT_CAPABILITY_MATRIX: readonly AgentCapabilityRow[] = [
  {
    agentId: "ceo",
    capabilities: ["llm_plan"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["cloud_agent_run", "production_deploy"],
    notes: "Planlama + görev oluşturma; kod/test yok.",
  },
  {
    agentId: "cto",
    capabilities: ["llm_analysis", "repo_read"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["protected_branch_merge"],
    notes: "Salt-okunur repo inceleme; yazma yok.",
  },
  {
    agentId: "developer",
    capabilities: ["llm_analysis", "sandbox_patch"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["real_repo_code_change", "git_push", "open_pr"],
    notes: "Patch yalnızca izole Docker sandbox; ana repo yazılmaz.",
  },
  {
    agentId: "tester",
    capabilities: ["llm_analysis", "sandbox_test"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["production_deploy"],
    notes: "Test yalnızca Docker network=none; package.json scripts yasak.",
  },
  {
    agentId: "security",
    capabilities: ["llm_analysis", "security_review", "repo_read"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["security_policy_change"],
    notes: "İnceleme/taslak risk; politika değiştirmez.",
  },
  {
    agentId: "growth-lead",
    capabilities: ["llm_analysis", "research"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["customer_message", "ad_campaign_launch"],
    notes: "Araştırma/öncelik; harcama/yayın yok.",
  },
  {
    agentId: "seo-specialist",
    capabilities: ["llm_analysis", "seo"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["blog_publish"],
    notes: "SEO bulgu/taslak; canlı yayın yok.",
  },
  {
    agentId: "content-manager",
    capabilities: ["llm_analysis", "content_draft"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["blog_publish"],
    notes: "İçerik taslağı; blog_publish Owner onayı.",
  },
  {
    agentId: "ads-manager",
    capabilities: ["llm_analysis", "ads_draft"],
    autoAllowedInControlledMode: true,
    requiresOwnerApprovalActions: ["ad_campaign_launch", "ad_budget_change"],
    notes: "Kampanya/bütçe taslağı; harcama yok.",
  },
] as const;

export function getAgentCapabilities(agentId: AgentId): AgentCapabilityRow {
  const row = AGENT_CAPABILITY_MATRIX.find((r) => r.agentId === agentId);
  if (!row) {
    throw new Error(`capability_missing:${agentId}`);
  }
  return row;
}

export function agentHasCapability(agentId: AgentId, kind: AgentCapabilityKind): boolean {
  return getAgentCapabilities(agentId).capabilities.includes(kind);
}

/** Matrix tüm AGENT_IDS'i kapsar mı? */
export function assertCapabilityMatrixComplete(): void {
  const ids = new Set(AGENT_CAPABILITY_MATRIX.map((r) => r.agentId));
  for (const id of AGENT_IDS) {
    if (!ids.has(id)) throw new Error(`capability_matrix_incomplete:${id}`);
  }
}

export const ControlledAutonomyModeSchema = z.enum(["off", "mock", "local"]);
export type ControlledAutonomyMode = z.infer<typeof ControlledAutonomyModeSchema>;
