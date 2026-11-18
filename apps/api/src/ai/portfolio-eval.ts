import type { AgentId, CeoPlan } from "@synaptech/shared";

type CeoPlanTask = CeoPlan["tasks"][number];

export const PORTFOLIO_SLUGS = ["synaptech-ai-os", "synaptech", "subify", "marivo"] as const;
export type PortfolioSlug = (typeof PORTFOLIO_SLUGS)[number];

export type PortfolioProjectInput = {
  slug: PortfolioSlug;
  goalKey: string | null;
  goalTitle: string | null;
  dataSource: string | null;
  openChildCount: number;
  lastAgentResultAt: string | null;
  verifiedOpportunityCount: number;
  opportunityId: string | null;
  opportunityTitle: string | null;
  repoVerified: boolean;
  recentlyServed: boolean;
};

export type ScoredPortfolioProject = PortfolioProjectInput & {
  score: number;
  reasons: string[];
  skipReason: string | null;
  suggestedAssignee: AgentId;
  evidenceHint: string;
  selected: boolean;
};

export type PersistDrop = {
  title: string;
  projectSlug: string;
  assigneeId: string;
  reasonCode: string;
};

const DEFAULT_ROLE: Record<PortfolioSlug, AgentId> = {
  "synaptech-ai-os": "cto",
  synaptech: "seo-specialist",
  subify: "cto",
  marivo: "growth-lead",
};

export function suggestAssigneeForProject(p: PortfolioProjectInput): AgentId {
  if (p.slug === "synaptech" && (p.dataSource === "not_connected" || p.goalKey === "website-seo")) {
    return "seo-specialist";
  }
  if (p.slug === "marivo") return "growth-lead";
  if (p.slug === "subify") return "cto";
  if (p.slug === "synaptech-ai-os") {
    if (p.recentlyServed) return "tester";
    return "cto";
  }
  return DEFAULT_ROLE[p.slug];
}

export function scorePortfolioProject(
  p: PortfolioProjectInput,
  now: Date,
): Omit<ScoredPortfolioProject, "selected"> {
  const reasons: string[] = [];
  let score = 0;
  const evidenceHint = p.goalKey
    ? `goal:${p.goalKey}`
    : p.opportunityId
      ? `opportunity:${p.opportunityId}`
      : p.repoVerified
        ? "mssql:Project"
        : "";

  const hasEvidence = Boolean(p.goalKey || p.verifiedOpportunityCount > 0 || p.repoVerified);
  if (!hasEvidence) {
    return {
      ...p,
      score: 0,
      reasons: ["no_goal_no_evidence"],
      skipReason: "no_evidence",
      suggestedAssignee: suggestAssigneeForProject(p),
      evidenceHint,
    };
  }

  if (p.goalKey) {
    score += 30;
    reasons.push("has_goal");
  }
  if (p.dataSource === "not_connected") {
    score += 10;
    reasons.push("metric_not_connected_research_ok");
  } else if (p.dataSource?.startsWith("mssql:")) {
    score += 12;
    reasons.push("metric_mssql");
  }
  if (p.verifiedOpportunityCount > 0) {
    score += 20;
    reasons.push("verified_opportunity");
  }
  if (p.repoVerified) {
    score += 10;
    reasons.push("repo_verified");
  } else {
    reasons.push("repo_unverified");
  }
  if (p.openChildCount === 0) {
    score += 18;
    reasons.push("no_open_children");
  } else {
    score -= Math.min(24, p.openChildCount * 4);
    reasons.push(`open_children:${p.openChildCount}`);
  }
  if (p.recentlyServed) {
    score -= 28;
    reasons.push("recently_served");
  }
  if (!p.lastAgentResultAt) {
    score += 16;
    reasons.push("never_worked");
  } else {
    const ageH = (now.getTime() - Date.parse(p.lastAgentResultAt)) / 3_600_000;
    if (Number.isFinite(ageH) && ageH >= 6) {
      score += 12;
      reasons.push("stale_work");
    }
  }

  let skipReason: string | null = null;
  if (p.openChildCount >= 4) skipReason = "project_queue_full";

  return {
    ...p,
    score,
    reasons,
    skipReason,
    suggestedAssignee: suggestAssigneeForProject(p),
    evidenceHint,
  };
}

export function selectPortfolioProjects(
  scored: Array<Omit<ScoredPortfolioProject, "selected">>,
  max = 3,
): ScoredPortfolioProject[] {
  const eligible = scored
    .filter((s) => !s.skipReason && s.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  for (const s of eligible) {
    if (picked.length >= max) break;
    if (!s.recentlyServed) picked.push(s.slug);
  }
  for (const s of eligible) {
    if (picked.length >= max) break;
    if (!picked.includes(s.slug)) picked.push(s.slug);
  }
  return scored.map((s) => ({ ...s, selected: picked.includes(s.slug) }));
}

export function groundedTaskForSelectedProject(
  p: ScoredPortfolioProject,
): CeoPlanTask {
  const notConnected = p.dataSource === "not_connected";
  const title = `${p.slug}: ${(p.goalTitle ?? p.opportunityTitle ?? "kanıtlı inceleme").slice(0, 48)}`.slice(
    0,
    80,
  );
  return {
    title,
    description: `Aşama A: ${p.reasons.slice(0, 4).join("; ")}`.slice(0, 220),
    projectSlug: p.slug,
    assigneeId: p.suggestedAssignee,
    priority: p.score >= 45 ? "high" : "medium",
    acceptanceCriteria: notConnected
      ? "Metriği uydurma. not_connected yaz; public_fetch veya mssql kanıtı olmadan done yok."
      : "Bağımsız acceptance: repo_read/sandbox_diff/public_fetch; done ancak kanıt varsa.",
    evidenceHint: p.evidenceHint || "mssql:CompanyGoal",
  };
}

export function mergeOmittedSelectedTasks(
  modelTasks: CeoPlanTask[],
  selected: ScoredPortfolioProject[],
): { tasks: CeoPlanTask[]; filled: string[] } {
  const present = new Set(modelTasks.map((t) => t.projectSlug));
  const filled: string[] = [];
  const extra: CeoPlanTask[] = [];
  for (const p of selected.filter((s) => s.selected)) {
    if (present.has(p.slug)) continue;
    extra.push(groundedTaskForSelectedProject(p));
    filled.push(p.slug);
    present.add(p.slug);
  }
  return { tasks: [...modelTasks, ...extra].slice(0, 8), filled };
}

export function decidePersistableTasks<T extends { task: CeoPlanTask; ok: boolean }>(input: {
  items: T[];
  selectedSlugs: string[];
  remainingSlots: number;
  isDuplicateTitle: (title: string) => boolean;
  isDuplicateWork?: (task: CeoPlanTask) => boolean;
}): { keep: T[]; drops: PersistDrop[] } {
  const drops: PersistDrop[] = [];
  const candidates: T[] = [];
  for (const item of input.items) {
    const t = item.task;
    if (!item.ok) {
      drops.push({
        title: t.title,
        projectSlug: t.projectSlug,
        assigneeId: t.assigneeId,
        reasonCode: "structural_reject",
      });
      continue;
    }
    if (input.isDuplicateTitle(t.title) || input.isDuplicateWork?.(t)) {
      drops.push({
        title: t.title,
        projectSlug: t.projectSlug,
        assigneeId: t.assigneeId,
        reasonCode: "duplicate_open_title",
      });
      continue;
    }
    if (input.selectedSlugs.length > 0 && !input.selectedSlugs.includes(t.projectSlug)) {
      drops.push({
        title: t.title,
        projectSlug: t.projectSlug,
        assigneeId: t.assigneeId,
        reasonCode: "not_in_stage_a_selection",
      });
      continue;
    }
    candidates.push(item);
  }

  const order = (slug: string) => {
    const i = input.selectedSlugs.indexOf(slug);
    return i === -1 ? 99 : i;
  };
  candidates.sort((a, b) => order(a.task.projectSlug) - order(b.task.projectSlug));

  const keep: T[] = [];
  const seen = new Set<string>();
  const cap = Math.max(0, input.remainingSlots);

  for (const item of candidates) {
    if (keep.length >= cap) break;
    const slug = item.task.projectSlug;
    if (seen.has(slug)) continue;
    keep.push(item);
    seen.add(slug);
  }
  for (const item of candidates) {
    if (keep.includes(item)) continue;
    if (keep.length >= cap) {
      drops.push({
        title: item.task.title,
        projectSlug: item.task.projectSlug,
        assigneeId: item.task.assigneeId,
        reasonCode: "queue_slot_exhausted",
      });
      continue;
    }
    keep.push(item);
  }
  return { keep, drops };
}

export function compactPortfolioPromptSlice(projects: ScoredPortfolioProject[]): string {
  const sel = projects
    .filter((p) => p.selected)
    .map(
      (p) =>
        `${p.slug}:score=${p.score},role=${p.suggestedAssignee},hint=${p.evidenceHint},ds=${p.dataSource ?? "none"}`,
    );
  const skip = projects
    .filter((p) => !p.selected)
    .map((p) => `${p.slug}:${p.skipReason ?? "lower_priority"}`);
  return [
    `selected=[${sel.join(" | ")}]`,
    `skipped=[${skip.join(" | ")}]`,
    "Her selected slug için 1 görev zorunlu. Seçilmeyene görev yazma.",
    "not_connected metriği uydurma; araştırma/public_fetch kabul.",
  ]
    .join(" ")
    .slice(0, 700);
}

export async function evaluateCompanyPortfolio(now = new Date()): Promise<{
  projects: ScoredPortfolioProject[];
  selectedSlugs: string[];
  starvingCount: number;
}> {
  const { getPrisma } = await import("../db/prisma.js");
  const { epochCreatedAtFilter } = await import("../engines/operation-epoch.js");
  const { listProjectRepoBindings } = await import("./repo/project-repo-registry.js");
  const prisma = getPrisma();
  const epochFilter = await epochCreatedAtFilter("current");
  const sinceRecent = new Date(now.getTime() - 2 * 60 * 60_000);

  const [goals, opps, children, recentCreated, results, bindings] = await Promise.all([
    prisma.companyGoal.findMany({
      where: { status: "active", projectSlug: { in: [...PORTFOLIO_SLUGS] } },
    }),
    prisma.opportunity.findMany({
      where: { projectSlug: { in: [...PORTFOLIO_SLUGS] }, status: "open", verified: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        source: "real",
        archivedAt: null,
        parentTaskId: { not: null },
        ...epochFilter,
        status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
        project: { slug: { in: [...PORTFOLIO_SLUGS] } },
      },
      select: { createdAt: true, project: { select: { slug: true } } },
    }),
    prisma.task.findMany({
      where: {
        source: "real",
        archivedAt: null,
        parentTaskId: { not: null },
        createdAt: { gte: sinceRecent },
        project: { slug: { in: [...PORTFOLIO_SLUGS] } },
      },
      select: { project: { select: { slug: true } } },
    }),
    prisma.agentMessage.findMany({
      where: { kind: { in: ["result", "handoff"] }, ...epochFilter },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { createdAt: true, taskId: true },
    }),
    listProjectRepoBindings(),
  ]);

  const taskIds = results.map((r) => r.taskId).filter(Boolean) as string[];
  const resultTasks =
    taskIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, project: { select: { slug: true } } },
        });
  const resultByTask = new Map(resultTasks.map((t) => [t.id, t.project.slug]));
  const lastResultAt = new Map<string, Date>();
  for (const r of results) {
    if (!r.taskId) continue;
    const slug = resultByTask.get(r.taskId);
    if (!slug || lastResultAt.has(slug)) continue;
    lastResultAt.set(slug, r.createdAt);
  }

  const inputs: PortfolioProjectInput[] = PORTFOLIO_SLUGS.map((slug) => {
    const g = goals.find((x) => x.projectSlug === slug);
    const opp = opps.find((x) => x.projectSlug === slug);
    const kids = children.filter((c) => c.project.slug === slug);
    const bind = bindings.find((b) => b.projectSlug === slug);
    return {
      slug,
      goalKey: g?.goalKey ?? null,
      goalTitle: g?.title ?? null,
      dataSource: g?.dataSource ?? null,
      openChildCount: kids.length,
      lastAgentResultAt: lastResultAt.get(slug)?.toISOString() ?? null,
      verifiedOpportunityCount: opps.filter((o) => o.projectSlug === slug).length,
      opportunityId: opp?.id ?? null,
      opportunityTitle: opp?.title ?? null,
      repoVerified: bind?.verified === true && bind.source === "mssql",
      recentlyServed: recentCreated.some((k) => k.project.slug === slug),
    };
  });

  const scored = inputs.map((p) => scorePortfolioProject(p, now));
  const projects = selectPortfolioProjects(scored, 3);
  const selectedSlugs = projects.filter((p) => p.selected).map((p) => p.slug);
  const starvingCount = projects.filter(
    (p) => !p.skipReason && p.openChildCount === 0 && !p.recentlyServed && p.score > 0,
  ).length;
  return { projects, selectedSlugs, starvingCount };
}
