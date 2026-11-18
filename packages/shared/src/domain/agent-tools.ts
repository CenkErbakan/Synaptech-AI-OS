import { z } from "zod";

/** Tek bir gerçek araç/kanıt kaydı — model iddiası değil. */
export const ToolEvidenceRecordSchema = z.object({
  kind: z.enum([
    "repo_list",
    "repo_read",
    "repo_head",
    "sandbox_command",
    "sandbox_diff",
    "binding_status",
    "blocked",
    "public_fetch",
  ]),
  projectSlug: z.string().min(1).max(80),
  path: z.string().max(1000).optional(),
  command: z.string().max(500).optional(),
  exitCode: z.number().int().optional(),
  stdoutDigest: z.string().max(128).optional(),
  commitSha: z.string().max(80).nullable().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: z.string().max(2000),
  trusted: z.boolean().default(false),
  at: z.string().datetime().optional(),
});
export type ToolEvidenceRecord = z.infer<typeof ToolEvidenceRecordSchema>;

export const ProjectRepoBindingSchema = z.object({
  projectSlug: z.string().min(1).max(80),
  githubRepoUrl: z.string().url().nullable(),
  localReadRoot: z.string().max(1000).nullable().default(null),
  /** Owner doğrulamadan true olamaz — keşif yeterli değil. */
  verified: z.boolean().default(false),
  verifiedBy: z.enum(["none", "mssql", "owner_file", "test_fixture"]).default("none"),
  evidenceNotes: z.array(z.string().max(500)).max(12).default([]),
  readOnly: z.boolean().default(true),
  writeAllowed: z.boolean().default(false),
});
export type ProjectRepoBinding = z.infer<typeof ProjectRepoBindingSchema>;

/** Bağımsız kabul doğrulama sonucu — model acceptanceMet'ini ezer. */
export const AcceptanceVerificationSchema = z.object({
  acceptanceMet: z.boolean(),
  codeChangeApplied: z.boolean(),
  reasons: z.array(z.string().max(500)).max(20),
  requiredEvidenceKinds: z.array(z.string()).default([]),
  presentEvidenceKinds: z.array(z.string()).default([]),
  findingCategory: z
    .enum(["structure_inspection", "dependency_analysis", "verified_defect", "none", "n/a"])
    .default("n/a"),
  modelAcceptanceIgnored: z.boolean().default(false),
});
export type AcceptanceVerification = z.infer<typeof AcceptanceVerificationSchema>;
