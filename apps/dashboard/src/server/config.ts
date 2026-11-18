import "server-only";

import {
  AgentRegistrySchema,
  AutomationsConfigSchema,
  BudgetPolicySchema,
  GuardPolicySchema,
  IntegrationsConfigSchema,
  KillSwitchSchema,
  PermissionsConfigSchema,
  ProjectsConfigSchema,
  SystemStatusSchema,
} from "@synaptech/shared";

import type { GuardStatus } from "@/lib/types";

import { loadJsonFile, loadYamlFile, readRepoText } from "./files";

export const loadBudgetPolicy = () => loadYamlFile("config/budget-policy.yaml", BudgetPolicySchema);
export const loadAgentRegistry = () => loadYamlFile("config/agents.yaml", AgentRegistrySchema);
export const loadProjects = () => loadYamlFile("config/projects.yaml", ProjectsConfigSchema);
export const loadPermissions = () => loadYamlFile("config/permissions.yaml", PermissionsConfigSchema);
export const loadAutomations = () => loadYamlFile("config/automations.yaml", AutomationsConfigSchema);
export const loadIntegrations = () => loadYamlFile("config/integrations.yaml", IntegrationsConfigSchema);
export const loadKillSwitch = () => loadJsonFile("config/kill-switch.json", KillSwitchSchema);
export const loadSystemStatus = () => loadYamlFile("config/system-status.yaml", SystemStatusSchema);

interface HooksFile {
  hooks?: Record<string, Array<{ command?: unknown }>>;
}

export async function loadGuardStatus(): Promise<GuardStatus> {
  const [hooksText, policy] = await Promise.all([
    readRepoText(".cursor/hooks.json"),
    loadJsonFile(".cursor/hooks/policy.json", GuardPolicySchema),
  ]);

  const status: GuardStatus = {
    hooksInstalled: hooksText !== null,
    mode: "none",
    events: [],
    policy: policy.ok ? policy.data : null,
    policyError: policy.ok ? undefined : policy.error,
  };

  if (hooksText !== null) {
    try {
      const parsed = JSON.parse(hooksText) as HooksFile;
      const hooks = parsed.hooks ?? {};
      status.events = Object.keys(hooks);
      const commands = Object.values(hooks)
        .flat()
        .map((hook) => String(hook.command ?? ""));
      if (commands.length > 0) {
        status.mode = commands.some((command) => command.includes("--observe")) ? "observe" : "enforce";
      }
    } catch (error) {
      status.hooksError = `hooks.json okunamadı: ${(error as Error).message}`;
    }
  }

  return status;
}
