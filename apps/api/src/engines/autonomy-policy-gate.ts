import {
  AGENT_CAPABILITY_MATRIX,
  agentHasCapability,
  getAgentCapabilities,
  type AgentCapabilityKind,
  type AgentId,
} from "@synaptech/shared";

import { getEnv } from "../lib/env.js";
import { getKillSwitch } from "./kill-switch.js";

/** Owner onayı olmadan otomatik yapılamayan eylemler. */
export const OWNER_GATED_ACTIONS = [
  "real_repo_code_change",
  "git_push",
  "open_pr",
  "protected_branch_merge",
  "production_deploy",
  "db_migration",
  "blog_publish",
  "ad_campaign_launch",
  "ad_budget_change",
  "customer_message",
  "cloud_agent_run",
  "security_policy_change",
] as const;

export type OwnerGatedAction = (typeof OWNER_GATED_ACTIONS)[number];

export type PolicyGateDecision = {
  allowed: boolean;
  reason: string;
  requiresOwnerApproval: boolean;
  capabilityOk: boolean;
  dockerRequired: boolean;
  verifiedRepoRequired: boolean;
};

const ROLE_CAPABILITY_FOR_ACTION: Partial<Record<string, AgentCapabilityKind>> = {
  llm_plan: "llm_plan",
  llm_analysis: "llm_analysis",
  repo_read: "repo_read",
  sandbox_patch: "sandbox_patch",
  sandbox_test: "sandbox_test",
  research: "research",
  seo: "seo",
  content_draft: "content_draft",
  security_review: "security_review",
  ads_draft: "ads_draft",
};

/** Senkron kurallar (kill/cloud hariç) — birim testleri. */
export function evaluateAutonomyPolicyRules(input: {
  agentId: AgentId | string;
  action: string;
  projectVerifiedRepo?: boolean;
  sandboxMode?: string;
}): PolicyGateDecision {
  const env = getEnv();
  const gated = OWNER_GATED_ACTIONS.includes(input.action as OwnerGatedAction);
  if (gated) {
    return {
      allowed: false,
      reason: `owner_gated:${input.action}`,
      requiresOwnerApproval: true,
      capabilityOk: true,
      dockerRequired: false,
      verifiedRepoRequired: false,
    };
  }

  let capabilityOk = true;
  const needed = ROLE_CAPABILITY_FOR_ACTION[input.action];
  if (needed) {
    try {
      capabilityOk = agentHasCapability(input.agentId as AgentId, needed);
    } catch {
      capabilityOk = false;
    }
  }
  if (!capabilityOk) {
    return {
      allowed: false,
      reason: `capability_denied:${input.agentId}:${input.action}`,
      requiresOwnerApproval: false,
      capabilityOk: false,
      dockerRequired: false,
      verifiedRepoRequired: false,
    };
  }

  const dockerRequired =
    input.action === "sandbox_patch" || input.action === "sandbox_test";
  if (dockerRequired && (input.sandboxMode ?? env.AGENT_SANDBOX_MODE) !== "isolated") {
    return {
      allowed: false,
      reason: "docker_isolation_required",
      requiresOwnerApproval: false,
      capabilityOk: true,
      dockerRequired: true,
      verifiedRepoRequired: false,
    };
  }

  const verifiedRepoRequired =
    input.action === "repo_read" ||
    input.action === "sandbox_patch" ||
    input.action === "sandbox_test";
  if (verifiedRepoRequired && input.projectVerifiedRepo === false) {
    return {
      allowed: false,
      reason: "unverified_repo_tools_blocked",
      requiresOwnerApproval: false,
      capabilityOk: true,
      dockerRequired,
      verifiedRepoRequired: true,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    requiresOwnerApproval: false,
    capabilityOk: true,
    dockerRequired,
    verifiedRepoRequired,
  };
}

/**
 * Kontrollü otonomi politika kapısı.
 * Model önerisi ≠ izin; Cloud/ücretli sessiz geçiş yok.
 */
export async function evaluateAutonomyPolicyGate(input: {
  agentId: AgentId | string;
  action: string;
  projectVerifiedRepo?: boolean;
  sandboxMode?: string;
}): Promise<PolicyGateDecision> {
  const kill = await getKillSwitch();
  if (kill.enabled) {
    return {
      allowed: false,
      reason: "kill_switch",
      requiresOwnerApproval: false,
      capabilityOk: false,
      dockerRequired: false,
      verifiedRepoRequired: false,
    };
  }

  const env = getEnv();
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    return {
      allowed: false,
      reason: "cloud_live_must_be_off_for_controlled_autonomy",
      requiresOwnerApproval: true,
      capabilityOk: false,
      dockerRequired: false,
      verifiedRepoRequired: false,
    };
  }

  return evaluateAutonomyPolicyRules(input);
}

/** İlk kontrollü modda otomatik izinli ajanlar (matrix). */
export function listAutoAllowedAgents(): AgentId[] {
  return AGENT_CAPABILITY_MATRIX.filter((r) => r.autoAllowedInControlledMode).map(
    (r) => r.agentId,
  );
}

export function agentRequiresOwnerFor(agentId: AgentId, action: string): boolean {
  const row = getAgentCapabilities(agentId);
  return row.requiresOwnerApprovalActions.includes(action);
}
