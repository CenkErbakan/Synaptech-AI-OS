import { z } from "zod";

/** Yürütme kanalları — birbirine karıştırılmaz. */
export const EXECUTION_KINDS = [
  "deterministic",
  "mock_llm",
  "local_llm",
  "cloud_coding",
  "real_ai_pending",
] as const;
export type ExecutionKindV2 = (typeof EXECUTION_KINDS)[number];
export const ExecutionKindV2Schema = z.enum(EXECUTION_KINDS);

export const MODEL_PROVIDER_IDS = ["none", "mock", "local"] as const;
export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

/**
 * Cursor Cloud Agents API bu arayüzün yerine geçmez.
 * Cloud = kod ajanı (repo üzerinde araçlı çalışma).
 * ModelProvider = yapılandırılmış plan / sohbet metni üretici.
 */
export const ModelProviderCapabilitySchema = z.object({
  structuredPlan: z.boolean(),
  chat: z.boolean(),
  codeAgent: z.boolean(),
  paidNetworkCall: z.boolean(),
  remainingUsageKnown: z.boolean(),
});
export type ModelProviderCapability = z.infer<typeof ModelProviderCapabilitySchema>;

export const CeoPlanTaskSchema = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(4000),
  projectSlug: z.enum(["synaptech-ai-os", "synaptech", "subify", "marivo"]),
  assigneeId: z.enum([
    "ceo",
    "cto",
    "developer",
    "tester",
    "security",
    "growth-lead",
    "seo-specialist",
    "content-manager",
    "ads-manager",
  ]),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  acceptanceCriteria: z.string().min(1).max(2000),
  evidenceHint: z.string().max(1000).optional(),
});

export const CeoPlanSchema = z.object({
  summary: z.string().min(1).max(2000),
  goalsAddressed: z.array(z.string().max(80)).max(20).default([]),
  tasks: z.array(CeoPlanTaskSchema).min(1).max(12),
  risks: z.array(z.string().max(500)).max(20).default([]),
  requiresOwnerApproval: z.boolean().default(true),
  estimatedAiCost: z.enum(["none", "local_compute", "cloud_unknown", "external_paid"]).default("none"),
});
export type CeoPlan = z.infer<typeof CeoPlanSchema>;

export const AgentEvidenceSchema = z.object({
  kind: z.enum(["test", "url", "file", "commit", "mssql", "audit", "artifact"]),
  ref: z.string().min(1).max(1000),
  note: z.string().max(1000).optional(),
});
export type AgentEvidence = z.infer<typeof AgentEvidenceSchema>;

export const ModelCompletionSchema = z.object({
  providerId: z.enum(MODEL_PROVIDER_IDS),
  modelId: z.string().max(120),
  realAiExecution: z.boolean(),
  content: z.string(),
  parsedPlan: CeoPlanSchema.optional(),
  evidence: z.array(AgentEvidenceSchema).default([]),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type ModelCompletion = z.infer<typeof ModelCompletionSchema>;

/** CTO bulgu sınıfı — yapı incelemesi ≠ doğrulanmış teknik sorun. */
export const CtoFindingKindSchema = z.enum([
  "structure_inspection",
  "dependency_analysis",
  "verified_defect",
  "none",
]);
export type CtoFindingKind = z.infer<typeof CtoFindingKindSchema>;

/** Sandbox içi izinli patch önerisi (tam dosya içeriği; ana repo yazılmaz). */
export const ProposedSandboxPatchSchema = z.object({
  path: z.string().min(1).max(400),
  content: z.string().max(80_000),
  reason: z.string().max(500).optional(),
});
export type ProposedSandboxPatch = z.infer<typeof ProposedSandboxPatchSchema>;

/** Büyüme/SEO/içerik/reklam/güvenlik taslak türü — yayın/harcama değildir. */
export const DraftOutputKindSchema = z.enum([
  "research_brief",
  "seo_findings",
  "content_draft",
  "ads_campaign_draft",
  "security_risk_review",
  "none",
]);
export type DraftOutputKind = z.infer<typeof DraftOutputKindSchema>;

/** Yerel ajan görev çıktısı — kod değişikliği ile öneri karıştırılmaz. */
export const AgentWorkResultSchema = z.object({
  summary: z.string().min(1).max(4000),
  analysis: z.string().min(1).max(8000),
  recommendations: z.array(z.string().max(1000)).max(12).default([]),
  acceptanceMet: z.boolean(),
  acceptanceNotes: z.string().max(2000).default(""),
  /** true yalnızca gerçek sandbox/repo değişikliği yapıldıysa — öneri false kalır */
  codeChangeApplied: z.boolean().default(false),
  evidenceUsed: z.array(z.string().max(500)).max(20).default([]),
  risks: z.array(z.string().max(500)).max(12).default([]),
  requiresOwnerApproval: z.boolean().default(true),
  /** Gerçek araç kanıt özetleri (model uydurması değil; doğrulayıcı doldurur). */
  toolEvidenceRefs: z.array(z.string().max(500)).max(40).default([]),
  findingKind: CtoFindingKindSchema.default("none"),
  /** Developer: yalnızca sandbox'a uygulanacak patch önerileri */
  proposedPatches: z.array(ProposedSandboxPatchSchema).max(5).default([]),
  /** Growth/SEO/content/ads/security: doğrulanabilir taslak sınıfı */
  draftKind: DraftOutputKindSchema.default("none"),
});
export type AgentWorkResult = z.infer<typeof AgentWorkResultSchema>;
