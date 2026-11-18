import { getPrisma } from "../db/prisma.js";

/**
 * CEO Chat bağlamı ve deterministik yanıt.
 * LLM bağlı değil — gerçek AI konuşması gibi sunulmamalı.
 */
export async function buildCeoChatContext() {
  const prisma = getPrisma();
  const [goals, opportunities, openTasks, chains, recentMessages, recentAudit] = await Promise.all([
    prisma.companyGoal.findMany({ where: { status: "active" }, orderBy: { projectSlug: "asc" }, take: 20 }),
    prisma.opportunity.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.task.findMany({
      where: {
        source: "real",
        archivedAt: null,
        ...(await import("./operation-epoch.js").then((m) => m.epochCreatedAtFilter("current"))),
        status: { in: ["planned", "in_progress", "testing", "in_review", "awaiting_approval"] },
      },
      include: { project: true },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    prisma.task.findMany({
      where: { source: "real", archivedAt: null, chainId: { not: null }, parentTaskId: null },
      include: { project: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.agentMessage.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.auditLog.findMany({
      where: { category: { in: ["coordination", "autonomy"] } },
      orderBy: { at: "desc" },
      take: 20,
    }),
  ]);

  return {
    source: "api" as const,
    llmIntegrated: false as const,
    chatMode: "deterministic_context" as const,
    cursorCloudIsChatProvider: false as const,
    disclaimer:
      "LLM sağlayıcısı bağlı değil (veya mock). Bu sohbet gerçek AI CEO konuşması değildir. Cursor Cloud Agents API sohbet/completions API'si değildir; yalnızca kod ajanı için kullanılır.",
    goals: goals.map((g) => ({
      goalKey: g.goalKey,
      projectSlug: g.projectSlug,
      title: g.title,
      kpiLabel: g.kpiLabel,
      currentValue: g.currentValue,
      dataSource: g.dataSource,
    })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      projectSlug: o.projectSlug,
      status: o.status,
      verified: o.verified,
      evidenceRef: o.evidenceRef,
    })),
    openTasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      projectSlug: t.project.slug,
      chainStep: t.chainStep,
      workflowPhase: t.workflowPhase,
    })),
    chains: chains.map((c) => ({
      id: c.id,
      chainId: c.chainId,
      title: c.title,
      status: c.status,
      workflowPhase: c.workflowPhase,
      projectSlug: c.project.slug,
      executionKind: c.executionKind,
    })),
    recentMessages: recentMessages.map((m) => ({
      id: m.id,
      from: m.fromAgentId,
      to: m.toAgentId,
      kind: m.kind,
      summary: m.summary,
      createdAt: m.createdAt.toISOString(),
    })),
    recentAudit: recentAudit.map((a) => ({
      action: a.action,
      summary: a.summary,
      at: a.at.toISOString(),
    })),
  };
}

export async function answerCeoChatDeterministic(userMessage: string): Promise<{
  source: "api";
  llmIntegrated: false;
  chatMode: "deterministic_context";
  reply: string;
  usedFacts: string[];
}> {
  const ctx = await buildCeoChatContext();
  const q = userMessage.toLowerCase();
  const usedFacts: string[] = [];
  const lines: string[] = [
    "[Deterministik CEO özeti — gerçek LLM yanıtı değil]",
    "",
  ];

  if (q.includes("fırsat") || q.includes("opportunity")) {
    lines.push(`Açık/son fırsatlar (${ctx.opportunities.length}):`);
    for (const o of ctx.opportunities.slice(0, 5)) {
      lines.push(`- [${o.status}] ${o.projectSlug}: ${o.title}`);
      usedFacts.push(`opportunity:${o.id}`);
    }
  } else if (q.includes("hedef") || q.includes("goal") || q.includes("kpi")) {
    lines.push(`Aktif hedefler (${ctx.goals.length}):`);
    for (const g of ctx.goals) {
      lines.push(`- ${g.projectSlug}: ${g.title} (${g.kpiLabel}; kaynak=${g.dataSource})`);
      usedFacts.push(`goal:${g.goalKey}`);
    }
  } else if (q.includes("zincir") || q.includes("chain") || q.includes("koordin")) {
    lines.push(`Aktif/son zincirler (${ctx.chains.length}):`);
    for (const c of ctx.chains) {
      lines.push(`- ${c.projectSlug}: ${c.title} · status=${c.status} · phase=${c.workflowPhase}`);
      usedFacts.push(`chain:${c.chainId}`);
    }
  } else if (q.includes("mesaj") || q.includes("iletişim") || q.includes("handoff")) {
    lines.push(`Son AgentMessage kayıtları (${ctx.recentMessages.length}):`);
    for (const m of ctx.recentMessages.slice(0, 8)) {
      lines.push(`- ${m.from}→${m.to} [${m.kind}] ${m.summary}`);
      usedFacts.push(`message:${m.id}`);
    }
  } else {
    lines.push(`Özet: ${ctx.goals.length} hedef, ${ctx.opportunities.length} fırsat, ${ctx.openTasks.length} açık görev, ${ctx.chains.length} zincir.`);
    lines.push("Örnek sorular: hedefler, fırsatlar, zincirler, mesajlar.");
    usedFacts.push("counts");
  }

  lines.push("");
  lines.push(ctx.disclaimer);

  return {
    source: "api",
    llmIntegrated: false,
    chatMode: "deterministic_context",
    reply: lines.join("\n"),
    usedFacts,
  };
}

/**
 * CEO Chat — ModelProvider üzerinden.
 * Gerçek model yoksa deterministik/mock açıkça etiketlenir; asla Cloud Agents API sohbet gibi sunulmaz.
 */
export async function updateCompanyGoalByOwner(input: {
  goalKey: string;
  title?: string;
  kpiLabel?: string;
  currentValue?: string;
}): Promise<{ ok: boolean; goalKey: string }> {
  const prisma = getPrisma();
  const existing = await prisma.companyGoal.findUnique({ where: { goalKey: input.goalKey } });
  if (!existing) {
    throw new Error("goal_not_found");
  }
  await prisma.companyGoal.update({
    where: { goalKey: input.goalKey },
    data: {
      ...(input.title ? { title: input.title } : {}),
      ...(input.kpiLabel ? { kpiLabel: input.kpiLabel } : {}),
      ...(input.currentValue !== undefined ? { currentValue: input.currentValue } : {}),
    },
  });
  const { writeAudit } = await import("./audit.js");
  await writeAudit({
    category: "autonomy",
    action: "ops.company_goal_updated",
    actorKind: "user",
    summary: `Owner hedef güncelledi: ${input.goalKey}`,
    metadata: { goalKey: input.goalKey, realAiExecution: false },
  });
  return { ok: true, goalKey: input.goalKey };
}

export async function answerCeoChat(userMessage: string): Promise<{
  source: "api";
  llmIntegrated: boolean;
  chatMode: "deterministic_context" | "mock_llm" | "local_llm";
  realAiExecution: boolean;
  reply: string;
  providerId: string;
  evidence: Array<{ kind: string; ref: string }>;
  usedFacts: string[];
}> {
  const { getEnv } = await import("../lib/env.js");
  const { resolveActiveModelProvider, requireLocalModelProvider } = await import(
    "../ai/providers/registry.js"
  );
  const env = getEnv();
  const ctx = await buildCeoChatContext();

  // Yerel mod: bağlantı yoksa mock'a düşme — hata fırlat
  if (env.MODEL_PROVIDER === "local") {
    const provider = await requireLocalModelProvider();
    const { buildLocalCeoSafeContext } = await import("../ai/local-ceo-context.js");
    const safeCtx = await buildLocalCeoSafeContext();
    const completion = await provider.chat({
      message: userMessage,
      contextSummary: JSON.stringify({
        goals: safeCtx.goals.slice(0, 8),
        opportunities: safeCtx.opportunities.slice(0, 8),
        openTasks: safeCtx.openTasks.length,
        projects: safeCtx.projects,
        toolsDenied: safeCtx.toolsDenied,
      }),
    });
    return {
      source: "api",
      llmIntegrated: true,
      chatMode: "local_llm",
      realAiExecution: completion.realAiExecution,
      reply: completion.content,
      providerId: completion.providerId,
      evidence: completion.evidence,
      usedFacts: ["provider:local", "mssql_readonly"],
    };
  }

  const resolved = await resolveActiveModelProvider();
  const det = await answerCeoChatDeterministic(userMessage);
  const mock = await resolved.provider.chat({
    message: userMessage,
    contextSummary: det.reply.slice(0, 1500),
  });
  return {
    source: "api",
    llmIntegrated: false,
    chatMode: "mock_llm",
    realAiExecution: false,
    reply: mock.content,
    providerId: mock.providerId,
    evidence: mock.evidence,
    usedFacts: det.usedFacts,
  };
}
