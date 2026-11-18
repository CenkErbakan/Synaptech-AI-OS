import { z } from "zod";

import { AgentIdSchema, DepartmentIdSchema } from "./agents";
import { ApprovalTypeSchema, RiskLevelSchema } from "./approvals";

export const AgentRegistrySchema = z.object({
  version: z.literal(1),
  departments: z.array(z.object({ id: DepartmentIdSchema, name: z.string() })),
  agents: z.array(
    z.object({
      id: AgentIdSchema,
      name: z.string(),
      department: DepartmentIdSchema,
      summary: z.string(),
      responsibilities: z.array(z.string()),
      enabled: z.boolean(),
    }),
  ),
});

export type AgentRegistry = z.infer<typeof AgentRegistrySchema>;
export type AgentRegistryEntry = AgentRegistry["agents"][number];

/** Cursor'ın belgelenmiş alt ajan alanları: name, description, model, readonly, is_background. */
export const AgentFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().optional(),
  readonly: z.boolean().optional(),
  is_background: z.boolean().optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export const ProjectsConfigSchema = z.object({
  version: z.literal(1),
  projects: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable(),
      status: z.string(),
      goals: z.array(z.string()),
      risks: z.array(z.string()),
      responsible_agents: z.array(AgentIdSchema),
      github: z.object({
        repo: z.string().nullable(),
        status: z.string(),
        planned_permissions: z.array(z.string()),
      }),
      source_code_policy: z.string(),
      existing_blog_automation: z
        .object({
          exists: z.boolean(),
          details: z.string().nullable(),
          rule: z.string(),
        })
        .optional(),
    }),
  ),
});

export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;
export type ProjectConfig = ProjectsConfig["projects"][number];

export const BudgetPolicySchema = z.object({
  version: z.literal(1),
  updated_at: z.string(),
  plan: z.object({
    provider: z.string(),
    name: z.string(),
    declared_by: z.string(),
    usage_pools: z.array(z.object({ id: z.string(), label: z.string() })),
    on_demand_usage: z.enum(["disabled", "enabled", "unknown"]),
    verification_url: z.string(),
  }),
  budget: z.object({
    extra_ai_api_usd_per_month: z.number(),
    allow_new_paid_services: z.boolean(),
    paid_services: z.array(z.object({ name: z.string(), monthly_usd: z.number() })),
  }),
  concurrency: z.object({
    max_concurrent_subagents: z.number().int().positive(),
    subagent_slot_ttl_minutes: z.number().int().positive(),
    max_subagent_launches_per_conversation: z.number().int().positive(),
  }),
  models: z.object({
    routine_default: z.string(),
    judgement_default: z.string(),
    denied_subagent_model_patterns: z.array(z.string()),
    per_agent: z.record(AgentIdSchema, z.string()),
    notes: z.array(z.string()),
  }),
  cloud: z.object({
    cloud_agents_enabled: z.boolean(),
    automations_enabled: z.boolean(),
    cost_gate: z.object({ status: z.string(), steps: z.array(z.string()) }),
    measured_usage_per_run: z.unknown().nullable(),
  }),
  tasks: z.object({
    max_retries: z.number().int().min(0),
    default_timeout_minutes: z.number().int().positive(),
  }),
  alerts: z.object({
    manual_pool_usage_warning_percent: z.number(),
    manual_pool_usage_critical_percent: z.number(),
  }),
});

export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;

export const PermissionsConfigSchema = z.object({
  version: z.literal(1),
  autonomy_level: z.string(),
  levels: z.record(z.string(), z.string()),
  actions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      level: z.enum(["auto", "approval", "forbidden"]),
      actors: z.array(z.string()).optional(),
      approval_type: ApprovalTypeSchema.nullable().optional(),
      risk: RiskLevelSchema.optional(),
      executor: z.string().optional(),
      enforced_by: z.array(z.string()).default([]),
    }),
  ),
});

export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

export const AutomationsConfigSchema = z.object({
  version: z.literal(1),
  global: z.object({
    enabled: z.boolean(),
    default_model: z.string(),
    memories: z.string(),
  }),
  automations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      phase: z.number().int(),
      runtime: z.enum(["cloud", "local"]),
      runtime_reason: z.string(),
      trigger: z.object({
        type: z.string(),
        schedule_human: z.string(),
        cron_utc: z.string().optional(),
        events: z.array(z.string()).optional(),
      }),
      agents: z.array(AgentIdSchema),
      tools: z.array(z.string()),
      outputs: z.array(z.string()),
      notes: z.string().optional(),
    }),
  ),
});

export type AutomationsConfig = z.infer<typeof AutomationsConfigSchema>;

export const INTEGRATION_STATUSES = [
  "connected",
  "not_connected",
  "not_configured",
  "not_installed",
  "unsupported",
] as const;

export const INTEGRATION_STATUS_LABELS: Record<(typeof INTEGRATION_STATUSES)[number], string> = {
  connected: "Bağlı",
  not_connected: "Bağlı değil",
  not_configured: "Yapılandırılmadı",
  not_installed: "Kurulmadı",
  unsupported: "Desteklenmiyor",
};

export const IntegrationsConfigSchema = z.object({
  version: z.literal(1),
  integrations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      status: z.enum(INTEGRATION_STATUSES),
      phase: z.number().int().nullable(),
      purpose: z.string(),
      auth: z.string(),
      planned_access: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
      versions: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>;

export const KillSwitchSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.string().nullable(),
  note: z.string().optional(),
});

export type KillSwitch = z.infer<typeof KillSwitchSchema>;

export const SystemStatusSchema = z.object({
  version: z.literal(1),
  phase: z.object({
    current: z.number().int(),
    total: z.number().int(),
    label: z.string(),
  }),
  autonomy: z.enum(["disabled", "enabled"]),
  integrations: z.object({
    cursor: z.string(),
    github: z.string(),
    task_engine: z.string(),
    database: z.string(),
  }),
  acceptance: z.object({
    phase3_passed: z.boolean(),
    phase4_e2e_passed: z.boolean(),
  }),
  statement: z.string(),
});

export type SystemStatus = z.infer<typeof SystemStatusSchema>;

/** `.cursor/hooks/policy.json` (guard'ın uyguladığı makine politikası). */
export const GuardPolicySchema = z.object({
  version: z.literal(1),
  phase: z.number().int(),
  killSwitchFile: z.string(),
  auditDir: z.string(),
  stateDir: z.string(),
  subagents: z.object({
    maxConcurrent: z.number().int().positive(),
    slotTtlMinutes: z.number().int().positive(),
    maxLaunchesPerConversation: z.number().int().positive(),
    launchWindowHours: z.number().int().positive(),
    deniedModelPatterns: z.array(z.string()),
  }),
  protectedPaths: z.array(z.string()),
  secretPaths: z.array(z.string()),
  secretPathExceptions: z.array(z.string()),
  mcp: z.object({
    allowedServers: z.array(z.string()),
    localhostOnlyServers: z.array(z.string()),
  }),
  shell: z.object({
    allowLocalhostNetwork: z.boolean(),
    denyAllDatabaseCli: z.boolean(),
    allowPushBranches: z.array(z.string()),
  }),
});

export type GuardPolicy = z.infer<typeof GuardPolicySchema>;
