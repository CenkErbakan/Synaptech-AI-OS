import { z } from "zod";

export const AGENT_IDS = [
  "ceo",
  "cto",
  "developer",
  "tester",
  "security",
  "growth-lead",
  "seo-specialist",
  "content-manager",
  "ads-manager",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export const AgentIdSchema = z.enum(AGENT_IDS);

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

export const DEPARTMENT_IDS = ["yonetim", "yazilim", "buyume"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];
export const DepartmentIdSchema = z.enum(DEPARTMENT_IDS);

export const AGENT_STATUSES = [
  "working",
  "awaiting_approval",
  "error",
  "completed",
  "idle",
  "disabled",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  working: "Çalışıyor",
  awaiting_approval: "Onay bekliyor",
  error: "Hata",
  completed: "Görev tamamlandı",
  idle: "Beklemede",
  disabled: "Devre dışı",
};

/** Politika tutarlılık testi `.cursor/agents/*.md` frontmatter'ını bu haritayla karşılaştırır. */
export const EXPECTED_READONLY: Readonly<Record<AgentId, boolean>> = {
  ceo: true,
  cto: true,
  developer: false,
  tester: false,
  security: true,
  "growth-lead": true,
  "seo-specialist": true,
  "content-manager": false,
  "ads-manager": true,
};
