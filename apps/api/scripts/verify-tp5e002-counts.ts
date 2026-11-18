import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const p = getPrisma();
  try {
    const total = await p.task.count();
    const active = await p.task.count({ where: { archivedAt: null } });
    const archived = await p.task.count({ where: { archivedAt: { not: null } } });
    const tp5e = await p.task.count({
      where: { archivedReason: { startsWith: "T-P5E-002" } },
    });
    const keep = await p.task.findMany({
      where: {
        id: {
          in: [
            "8ca354e8-f25b-432d-acc5-73105f3e5a89",
            "462490ee-bbf4-4ec3-b2ac-59e8134966ce",
          ],
        },
      },
      select: { id: true, title: true, status: true, archivedAt: true },
    });
    const runs = await p.agentRun.count();
    const msgs = await p.agentMessage.count();
    const appr = await p.approval.count();
    const audit = await p.auditLog.count();
    const projects = await p.project.count();
    const seo = await p.seoFinding.count().catch(() => -1);
    const leads = await p.lead.count().catch(() => -1);
    console.log(
      JSON.stringify(
        { total, active, archived, tp5e, keep, runs, msgs, appr, audit, projects, seo, leads },
        null,
        2,
      ),
    );
  } finally {
    await disconnectPrisma();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
