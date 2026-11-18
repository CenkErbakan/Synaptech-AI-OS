import { createHash } from "node:crypto";

/** Pilot: yalnızca bu base ref'lerden dallanılır; üzerine yazılmaz. */
export const PROTECTED_BASE_REFS = ["main", "master"] as const;

/** Cursor'un yeni branch üretmesi için zorunlu. */
export const PILOT_WORK_ON_CURRENT_BRANCH = false as const;

/** İlk pilotta PR otomatik açılmaz. */
export const PILOT_AUTO_CREATE_PR = false as const;

/** İzinli çalışma branch önekleri (Cursor varsayılanı cursor/...). */
export const PILOT_ALLOWED_BRANCH_PREFIXES = ["cursor/", "agent/"] as const;

export interface CloudRunVersionInput {
  title: string;
  description: string;
  repositoryUrl: string;
  startingRef: string;
  /** tasks/T-P4B-001-*.md SHA-256 (varsa). */
  briefSha256?: string;
}

/**
 * Owner onayına bağlanan içerik sürümü.
 * title/description + repo + branch politikası; değişirse execute reddedilir.
 */
export function computeCloudRunContentVersion(input: CloudRunVersionInput): string {
  const startingRef = input.startingRef.trim().toLowerCase();
  if (!(PROTECTED_BASE_REFS as readonly string[]).includes(startingRef)) {
    throw new Error(`startingRef korumalı base olmalı (main|master): ${input.startingRef}`);
  }
  const canonical = [
    input.title.trim(),
    input.description.trim(),
    input.repositoryUrl.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase(),
    `startingRef=${startingRef}`,
    `autoCreatePR=${PILOT_AUTO_CREATE_PR}`,
    `workOnCurrentBranch=${PILOT_WORK_ON_CURRENT_BRANCH}`,
    `protectedBases=${PROTECTED_BASE_REFS.join(",")}`,
    `allowedBranchPrefixes=${PILOT_ALLOWED_BRANCH_PREFIXES.join(",")}`,
    `briefSha256=${input.briefSha256 ?? "none"}`,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function assertPilotCreateOptions(options: {
  startingRef: string;
  autoCreatePR: boolean;
  workOnCurrentBranch: boolean;
}): void {
  const ref = options.startingRef.trim().toLowerCase();
  if (!(PROTECTED_BASE_REFS as readonly string[]).includes(ref)) {
    throw new Error(`Yasak startingRef: ${options.startingRef} (yalnızca main|master base).`);
  }
  if (options.workOnCurrentBranch !== false) {
    throw new Error("workOnCurrentBranch zorunlu false — main/master üzerine yazma yasak.");
  }
  if (options.autoCreatePR !== false) {
    throw new Error("autoCreatePR zorunlu false — otomatik PR/merge yok.");
  }
}

export function isProtectedBaseBranch(branch: string): boolean {
  return (PROTECTED_BASE_REFS as readonly string[]).includes(branch.trim().toLowerCase());
}

export function isAllowedAgentBranch(branch: string): boolean {
  const b = branch.trim().toLowerCase();
  return PILOT_ALLOWED_BRANCH_PREFIXES.some((p) => b.startsWith(p));
}
