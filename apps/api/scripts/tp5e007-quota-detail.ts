/** Kota ayrıntısı — LLM yok. */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { writeFileSync } from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const { resetEnvCacheForTests } = await import("../src/lib/env.js");
  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const prisma = getPrisma();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.auditLog.findMany({
    where: {
      action: {
        in: ["ai.scheduler_ceo_cycle", "ai.local_ceo_pilot", "ai.local_agent_execution"],
      },
      at: { gte: start, lt: end },
    },
    orderBy: { at: "desc" },
    select: { action: true, at: true, summary: true, metadata: true, actorAgent: true },
  });

  function meta(m: string | null) {
    if (!m) return {};
    try {
      return JSON.parse(m) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const detailed = rows.map((r) => {
    const md = meta(r.metadata);
    return {
      action: r.action,
      at: r.at.toISOString(),
      actorAgent: r.actorAgent,
      realAiExecution: md.realAiExecution === true || md.mode === "local",
      mode: md.mode ?? null,
      summary: (r.summary ?? "").slice(0, 120),
    };
  });

  const realCeo = detailed.filter(
    (d) =>
      (d.action === "ai.scheduler_ceo_cycle" || d.action === "ai.local_ceo_pilot") &&
      d.realAiExecution,
  );
  const allCeoAudits = detailed.filter(
    (d) => d.action === "ai.scheduler_ceo_cycle" || d.action === "ai.local_ceo_pilot",
  );
  const realAgents = detailed.filter(
    (d) => d.action === "ai.local_agent_execution" && d.realAiExecution,
  );

  // If SCHEDULER_AI_CEO_MODE=local, assertSchedulerAiCeoDailyBudget uses real only
  process.env.SCHEDULER_AI_CEO_MODE = "local";
  process.env.LOCAL_AGENT_EXECUTION_MODE = "local";
  resetEnvCacheForTests();
  const {
    assertSchedulerAiCeoDailyBudget,
    assertLocalAgentExecutionDailyBudget,
  } = await import("../src/ai/llm-call-guard.js");
  const ceoLocal = await assertSchedulerAiCeoDailyBudget();
  const agentLocal = await assertLocalAgentExecutionDailyBudget();

  const out = {
    utcDay: start.toISOString(),
    counts: {
      allCeoAudits: allCeoAudits.length,
      realCeoAudits: realCeo.length,
      realAgentAudits: realAgents.length,
      totalRows: rows.length,
    },
    budgetIfModesLocal: { ceoLocal, agentLocal },
    headroomForOneCycle: {
      ceoOk: ceoLocal.ok && ceoLocal.max - ceoLocal.used >= 1,
      agentsOk: agentLocal.ok && agentLocal.max - agentLocal.used >= 2,
      note: "Limitler değiştirilmedi; sıfırlama yok.",
    },
    recentReal: [...realCeo, ...realAgents].slice(0, 20),
  };

  const pathOut = path.resolve(process.cwd(), "../../reports/qa/faz-5e-tp5e007-quota-detail.json");
  writeFileSync(pathOut, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(out, null, 2));
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
