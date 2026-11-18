import { createHash } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "./audit.js";

const PROJECTS = ["synaptech-ai-os", "synaptech", "subify", "marivo"] as const;

function dedupe(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 64);
}

export interface OpportunityScanResult {
  scannedProjects: string[];
  created: Array<{ id: string; title: string; projectSlug: string; verified: boolean }>;
  skippedDuplicates: number;
}

/**
 * Deterministik fırsat taraması — LLM değildir.
 * Kanıt: açık görevler, stale/failed run’lar, proje kaydı.
 */
export async function scanOpportunities(): Promise<OpportunityScanResult> {
  const prisma = getPrisma();
  const created: OpportunityScanResult["created"] = [];
  let skippedDuplicates = 0;

  const projects = await prisma.project.findMany({
    where: { status: "active" },
    orderBy: { slug: "asc" },
  });

  for (const project of projects) {
    if (!(PROJECTS as readonly string[]).includes(project.slug)) continue;

    const openTasks = await prisma.task.count({
      where: {
        projectId: project.id,
        archivedAt: null,
        status: { in: ["planned", "in_progress", "testing", "in_review"] },
        paused: false,
      },
    });

    const failedRuns = await prisma.agentRun.count({
      where: {
        task: { projectId: project.id },
        OR: [{ status: "failed" }, { cursorStatus: "ERROR" }, { reconcileState: "stale_mock" }],
      },
    });

    // Görev birikimi / mükerrer fırsat: projede zaten ≥3 açık fırsat varsa yeni üretme
    const openOpps = await prisma.opportunity.count({
      where: { projectSlug: project.slug, status: "open" },
    });
    if (openOpps >= 3) {
      skippedDuplicates += 1;
      continue;
    }

    // Kanıt 1: proje kaydı var + cloud kapalı → işletim/ürün iyileştirme fırsatı
    const baseHash = dedupe(["project-health", project.slug, project.cloudAgentEnabled ? "1" : "0"]);
    const existingBase = await prisma.opportunity.findUnique({ where: { dedupeHash: baseHash } });
    if (!existingBase) {
      const opp = await prisma.opportunity.create({
        data: {
          title: `${project.name}: operasyonel değerlendirme fırsatı`,
          description: [
            "Deterministik tarama (LLM değil).",
            `Proje slug=${project.slug}; cloudAgentEnabled=${project.cloudAgentEnabled}.`,
            `Açık görev sayısı (kanıt): ${openTasks}.`,
            "Önerilen sonraki adım: CEO planı ile alt görev oluşturup uygun ajana ata.",
          ].join(" "),
          projectSlug: project.slug,
          sourceKind: "mssql_project_snapshot",
          evidenceRef: `project:${project.id}:openTasks=${openTasks}`,
          commercialValue: "medium",
          confidence: openTasks >= 0 ? "medium" : "low",
          estimatedEffort: "S",
          estimatedAiCost: "none_deterministic",
          securityRisk: "low",
          suggestedAgentId: project.slug === "synaptech-ai-os" ? "cto" : "growth-lead",
          suggestedNextStep: "CEO orchestrator alt görev üretsin",
          status: "open",
          verified: true,
          dedupeHash: baseHash,
          updatedAt: new Date(),
        },
      });
      created.push({
        id: opp.id,
        title: opp.title,
        projectSlug: opp.projectSlug,
        verified: opp.verified,
      });
    } else {
      skippedDuplicates += 1;
    }

    // Kanıt 2: başarısız/stale run varsa kalite fırsatı
    if (failedRuns > 0) {
      const failHash = dedupe(["failed-runs", project.slug, String(failedRuns > 0)]);
      const existingFail = await prisma.opportunity.findUnique({ where: { dedupeHash: failHash } });
      if (!existingFail) {
        const opp = await prisma.opportunity.create({
          data: {
            title: `${project.name}: başarısız/stale run temizliği`,
            description: [
              "Deterministik tarama (LLM değil).",
              `failedOrStaleRuns=${failedRuns} (MSSQL AgentRun kanıtı).`,
              "Reconciliation ve test kapsamı gözden geçirilmeli.",
            ].join(" "),
            projectSlug: project.slug,
            sourceKind: "mssql_agent_run",
            evidenceRef: `project:${project.id}:failedRuns=${failedRuns}`,
            commercialValue: "low",
            confidence: "high",
            estimatedEffort: "S",
            estimatedAiCost: "none_deterministic",
            securityRisk: "low",
            suggestedAgentId: "tester",
            suggestedNextStep: "Tester regresyon ve reconciliation doğrulasın",
            status: "open",
            verified: true,
            dedupeHash: failHash,
            updatedAt: new Date(),
          },
        });
        created.push({
          id: opp.id,
          title: opp.title,
          projectSlug: opp.projectSlug,
          verified: opp.verified,
        });
      } else {
        skippedDuplicates += 1;
      }
    }
  }

  await writeAudit({
    category: "autonomy",
    action: "opportunity.scan_completed",
    actorKind: "system",
    actorAgent: "ceo",
    summary: `Fırsat taraması: ${created.length} yeni, ${skippedDuplicates} tekrar.`,
    metadata: { created: created.length, skippedDuplicates, planner: "deterministic" },
  });

  return {
    scannedProjects: projects.map((p) => p.slug),
    created,
    skippedDuplicates,
  };
}
