import type {
  AgentEvidence,
  AgentWorkResult,
  CeoPlan,
  ModelCompletion,
  ModelProviderCapability,
  ModelProviderId,
} from "@synaptech/shared";

export interface PlanRequest {
  goals: Array<{ goalKey: string; projectSlug: string; title: string; dataSource: string }>;
  opportunities: Array<{ id: string; title: string; projectSlug: string; evidenceRef: string | null }>;
  openTaskCount: number;
  instruction?: string;
}

export interface ChatRequest {
  message: string;
  contextSummary: string;
}

export interface AgentWorkRequest {
  agentId: string;
  systemPrompt: string;
  task: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string | null;
    projectSlug: string;
    priority: string;
  };
  contextSummary: string;
}

export interface ModelProvider {
  readonly id: ModelProviderId;
  readonly displayName: string;
  capabilities(): ModelProviderCapability;
  /** Sağlık / kullanılabilirlik — ücretli çağrı yapmaz. */
  probe(): Promise<{ ok: boolean; message: string }>;
  generateCeoPlan(request: PlanRequest): Promise<ModelCompletion>;
  chat(request: ChatRequest): Promise<ModelCompletion>;
  /** CEO dışı ajan görev çıktısı (yapılandırılmış JSON). */
  executeAgentWork(request: AgentWorkRequest): Promise<ModelCompletion & { parsedWork?: AgentWorkResult }>;
}

export function isRealAiCompletion(c: ModelCompletion): boolean {
  return c.realAiExecution === true && c.providerId !== "mock" && c.providerId !== "none";
}

export function evidenceLine(items: AgentEvidence[]): string {
  if (!items.length) return "evidence:none";
  return items.map((e) => `${e.kind}:${e.ref}`).join(" | ");
}

export type { CeoPlan, ModelCompletion, ModelProviderCapability, ModelProviderId };
