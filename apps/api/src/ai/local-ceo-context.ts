import { getPrisma } from "../db/prisma.js";

const PROJECTS = ["synaptech-ai-os", "synaptech", "subify", "marivo"] as const;

/**
 * CEO'ya verilen sınırlı, salt-okunur MSSQL bağlamı.
 * Yazma / onay / bütçe / Cloud araçları yok.
 */
export async function buildLocalCeoSafeContext() {
  const prisma = getPrisma();
  const { epochCreatedAtFilter } = await import("../engines/operation-epoch.js");
  const epochFilter = await epochCreatedAtFilter("current");
  const projects = await prisma.project.findMany({
    where: { slug: { in: [...PROJECTS] } },
    orderBy: { slug: "asc" },
  });

  const [goals, opportunities, openTasks, recentChains, recentResults, epochChildTitles, killRow] =
    await Promise.all([
    prisma.companyGoal.findMany({
      where: { status: "active", projectSlug: { in: [...PROJECTS] } },
      take: 24,
      orderBy: { projectSlug: "asc" },
    }),
    prisma.opportunity.findMany({
      where: { projectSlug: { in: [...PROJECTS] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        source: "real",
        archivedAt: null,
        ...epochFilter,
        status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
        project: { slug: { in: [...PROJECTS] } },
      },
      include: { project: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.task.findMany({
      where: {
        source: "real",
        archivedAt: null,
        chainId: { not: null },
        parentTaskId: null,
        ...epochFilter,
        project: { slug: { in: [...PROJECTS] } },
      },
      include: { project: true },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    prisma.agentMessage.findMany({
      where: {
        kind: { in: ["result", "handoff"] },
        ...epochFilter,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        fromAgentId: true,
        toAgentId: true,
        kind: true,
        summary: true,
        taskId: true,
        createdAt: true,
        evidenceRef: true,
      },
    }),
    prisma.task.findMany({
      where: {
        source: "real",
        parentTaskId: { not: null },
        ...epochFilter,
        project: { slug: { in: [...PROJECTS] } },
      },
      select: { title: true, status: true, assigneeId: true, project: { select: { slug: true } } },
      take: 80,
      orderBy: { createdAt: "desc" },
    }),
    prisma.systemSetting.findUnique({ where: { key: "kill_switch" } }),
  ]);

  let killEnabled = false;
  if (killRow) {
    try {
      killEnabled = Boolean(JSON.parse(killRow.value).enabled);
    } catch {
      killEnabled = false;
    }
  }

  return {
    source: "mssql_readonly" as const,
    pilotTag: "local-ai-ceo-pilot" as const,
    toolsAllowed: [
      "read_goals",
      "read_opportunities",
      "read_tasks",
      "read_chains",
      "read_agent_results",
      "read_kill_switch_flag",
    ] as const,
    toolsDenied: [
      "set_kill_switch",
      "approve",
      "cloud_create",
      "budget_change",
      "customer_message",
      "blog_publish",
      "ad_launch",
      "git_push",
      "deploy",
    ] as const,
    killSwitchEnabled: killEnabled,
    projects: projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      status: p.status,
      cloudAgentEnabled: p.cloudAgentEnabled,
    })),
    goals: goals.map((g) => ({
      goalKey: g.goalKey,
      projectSlug: g.projectSlug,
      title: g.title,
      kpiLabel: g.kpiLabel,
      currentValue: g.currentValue,
      targetValue: g.targetValue,
      dataSource: g.dataSource,
    })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      projectSlug: o.projectSlug,
      title: o.title,
      status: o.status,
      verified: o.verified,
      evidenceRef: o.evidenceRef,
      suggestedAgentId: o.suggestedAgentId,
    })),
    openTasks: openTasks.map((t) => ({
      id: t.id,
      projectSlug: t.project.slug,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      chainStep: t.chainStep,
      workflowPhase: t.workflowPhase,
      origin: t.origin,
    })),
    chains: recentChains.map((c) => ({
      chainId: c.chainId,
      projectSlug: c.project.slug,
      title: c.title,
      status: c.status,
      executionKind: c.executionKind,
    })),
    recentAgentResults: recentResults.map((m) => ({
      id: m.id,
      from: m.fromAgentId,
      to: m.toAgentId,
      kind: m.kind,
      summary: m.summary.slice(0, 120),
      evidenceRef: m.evidenceRef ? String(m.evidenceRef).slice(0, 80) : null,
      taskId: m.taskId,
      at: m.createdAt.toISOString(),
    })),
    epochChildTitles: epochChildTitles.map((t) => ({
      title: t.title.slice(0, 60),
      status: t.status,
      assigneeId: t.assigneeId,
      projectSlug: t.project.slug,
    })),
  };
}
