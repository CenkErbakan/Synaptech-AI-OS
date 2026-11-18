import type { CeoPlan, CeoPlanTask } from "@synaptech/shared";

import { getPrisma } from "../db/prisma.js";

const PROJECT_SLUGS = new Set(["synaptech-ai-os", "synaptech", "subify", "marivo"]);
const AGENTS = new Set([
  "ceo",
  "cto",
  "developer",
  "tester",
  "security",
  "growth-lead",
  "seo-specialist",
  "content-manager",
  "ads-manager",
]);
const PRIORITIES = new Set(["low", "medium", "high"]);

export type TaskValidation = {
  task: CeoPlanTask;
  ok: boolean;
  verified: boolean;
  reasons: string[];
  evidenceResolved: string | null;
};

/**
 * Proje slug tek başına grounding sayılmaz.
 * evidenceHint UUID veya mssql:<Tablo> ise gerçek kayıt/adet doğrulanır.
 */
export async function validateAndGroundPlanTasks(plan: CeoPlan): Promise<{
  validations: TaskValidation[];
  accepted: TaskValidation[];
  unverified: TaskValidation[];
  rejected: TaskValidation[];
}> {
  const prisma = getPrisma();
  const projects = await prisma.project.findMany({
    where: { slug: { in: [...PROJECT_SLUGS] } },
    select: { id: true, slug: true },
  });
  const projectBySlug = new Map(projects.map((p) => [p.slug, p]));

  const validations: TaskValidation[] = [];

  for (const task of plan.tasks) {
    const reasons: string[] = [];
    if (!PROJECT_SLUGS.has(task.projectSlug) || !projectBySlug.has(task.projectSlug)) {
      reasons.push("invalid_or_missing_project");
    }
    if (!AGENTS.has(task.assigneeId)) reasons.push("invalid_assignee");
    if (!PRIORITIES.has(task.priority)) reasons.push("invalid_priority");
    if (!task.acceptanceCriteria?.trim()) reasons.push("missing_acceptance_criteria");
    if (!task.title?.trim() || task.title.trim().length < 3) reasons.push("invalid_title");

    let verified = false;
    let evidenceResolved: string | null = null;
    const hint = task.evidenceHint?.trim() ?? "";

    if (!hint) {
      reasons.push("missing_evidence_hint");
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hint)) {
      const [goal, opp, taskRow, seo] = await Promise.all([
        prisma.companyGoal.findUnique({ where: { id: hint }, select: { id: true } }),
        prisma.opportunity.findUnique({ where: { id: hint }, select: { id: true } }),
        prisma.task.findUnique({ where: { id: hint }, select: { id: true } }),
        prisma.seoFinding.findUnique({ where: { id: hint }, select: { id: true } }).catch(() => null),
      ]);
      if (goal) {
        verified = true;
        evidenceResolved = `companyGoal:${goal.id}`;
      } else if (opp) {
        verified = true;
        evidenceResolved = `opportunity:${opp.id}`;
      } else if (taskRow) {
        verified = true;
        evidenceResolved = `task:${taskRow.id}`;
      } else if (seo) {
        verified = true;
        evidenceResolved = `seoFinding:${seo.id}`;
      } else {
        reasons.push("evidence_uuid_not_found");
      }
    } else if (hint.toLowerCase().startsWith("mssql:")) {
      const table = hint.slice("mssql:".length).trim().toLowerCase();
      let count = 0;
      if (table === "opportunity") count = await prisma.opportunity.count();
      else if (table === "companygoal") count = await prisma.companyGoal.count();
      else if (table === "task") count = await prisma.task.count({ where: { archivedAt: null } });
      else if (table === "seofinding") count = await prisma.seoFinding.count();
      else if (table === "scheduledjobrun") count = await prisma.scheduledJobRun.count();
      else if (table === "lead") count = await prisma.lead.count();
      else if (table === "project") count = await prisma.project.count();
      else reasons.push("unknown_mssql_evidence_table");

      if (!reasons.includes("unknown_mssql_evidence_table")) {
        if (count > 0) {
          verified = true;
          evidenceResolved = `${hint}#count=${count}`;
        } else {
          reasons.push("mssql_evidence_table_empty");
        }
      }
    } else if (hint.startsWith("goal:") || hint.startsWith("opportunity:")) {
      const id = hint.split(":").slice(1).join(":").trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (id) {
        if (hint.startsWith("goal:")) {
          const g = isUuid
            ? await prisma.companyGoal.findFirst({
                where: { OR: [{ id }, { goalKey: id }] },
                select: { id: true },
              })
            : await prisma.companyGoal.findFirst({
                where: { goalKey: id },
                select: { id: true },
              });
          if (g) {
            verified = true;
            evidenceResolved = `companyGoal:${g.id}`;
          } else reasons.push("goal_ref_not_found");
        } else if (isUuid) {
          const o = await prisma.opportunity.findUnique({ where: { id }, select: { id: true } });
          if (o) {
            verified = true;
            evidenceResolved = `opportunity:${o.id}`;
          } else reasons.push("opportunity_ref_not_found");
        } else {
          reasons.push("opportunity_ref_not_uuid");
        }
      } else reasons.push("malformed_evidence_ref");
    } else {
      reasons.push("unrecognized_evidence_hint");
    }

    // Şema/politika hataları → reject; yalnızca evidence zayıfsa unverified kabul edilebilir
    const structuralFail = reasons.some((r) =>
      [
        "invalid_or_missing_project",
        "invalid_assignee",
        "invalid_priority",
        "missing_acceptance_criteria",
        "invalid_title",
      ].includes(r),
    );
    const ok = !structuralFail;
    validations.push({
      task,
      ok,
      verified: ok && verified,
      reasons,
      evidenceResolved,
    });
  }

  return {
    validations,
    accepted: validations.filter((v) => v.ok && v.verified),
    unverified: validations.filter((v) => v.ok && !v.verified),
    rejected: validations.filter((v) => !v.ok),
  };
}

export function normalizeTitleKey(title: string): string {
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
