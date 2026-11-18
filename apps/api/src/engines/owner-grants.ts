import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "./audit.js";

export const OWNER_GRANTS_KEY = "owner_capability_grants";

export type OwnerGrants = {
  githubRepoCreate: boolean;
  githubPushDraftPr: boolean;
  customerOutreach: boolean;
  productionDeploy: boolean;
  financialSpend: boolean;
  /** T-P5E-009 24s pencereden ayrı kalıcı yerel otonomi. Runtime env hâlâ Owner yazar. */
  permanentLocalAutonomy: boolean;
};

export const DEFAULT_OWNER_GRANTS: OwnerGrants = {
  githubRepoCreate: false,
  githubPushDraftPr: false,
  customerOutreach: false,
  productionDeploy: false,
  financialSpend: false,
  permanentLocalAutonomy: false,
};

export const GRANT_LABELS: Record<keyof OwnerGrants, string> = {
  githubRepoCreate: "GitHub deposu oluşturma",
  githubPushDraftPr: "Branch push ve Draft PR",
  customerOutreach: "Müşteri iletişimi",
  productionDeploy: "Production deploy",
  financialSpend: "Finansal harcama / reklam bütçesi",
  permanentLocalAutonomy: "Kalıcı yerel otonomi (Ollama; 24s pencereden ayrı)",
};

export async function readOwnerGrants(): Promise<OwnerGrants> {
  const row = await getPrisma().systemSetting.findUnique({ where: { key: OWNER_GRANTS_KEY } });
  if (!row?.value) return { ...DEFAULT_OWNER_GRANTS };
  try {
    return { ...DEFAULT_OWNER_GRANTS, ...(JSON.parse(row.value) as Partial<OwnerGrants>) };
  } catch {
    return { ...DEFAULT_OWNER_GRANTS };
  }
}

export async function writeOwnerGrants(
  patch: Partial<OwnerGrants>,
  actor = "owner",
): Promise<OwnerGrants> {
  const current = await readOwnerGrants();
  const next: OwnerGrants = { ...current };
  for (const key of Object.keys(DEFAULT_OWNER_GRANTS) as (keyof OwnerGrants)[]) {
    if (typeof patch[key] === "boolean") next[key] = patch[key]!;
  }
  await getPrisma().systemSetting.upsert({
    where: { key: OWNER_GRANTS_KEY },
    create: { key: OWNER_GRANTS_KEY, value: JSON.stringify(next), updatedBy: actor },
    update: { value: JSON.stringify(next), updatedBy: actor, updatedAt: new Date() },
  });
  await writeAudit({
    category: "security",
    action: "ops.owner_grants_updated",
    actorKind: "user",
    summary: "Owner yetki kapıları güncellendi",
    metadata: { previous: current, next, realAiExecution: false },
  });
  return next;
}

export async function assertOwnerGrant(key: keyof OwnerGrants): Promise<{ ok: boolean; reason: string }> {
  const grants = await readOwnerGrants();
  if (grants[key]) return { ok: true, reason: "granted" };
  return { ok: false, reason: `owner_grant_required:${key}` };
}
