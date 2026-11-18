import { describe, expect, it } from "vitest";

import {
  decidePersistableTasks,
  mergeOmittedSelectedTasks,
  scorePortfolioProject,
  selectPortfolioProjects,
  type PortfolioProjectInput,
  type ScoredPortfolioProject,
} from "../src/ai/portfolio-eval.js";
import { reassignCeoTaskRole } from "../src/ai/plan-role-gate.js";

function base(partial: Partial<PortfolioProjectInput> & Pick<PortfolioProjectInput, "slug">): PortfolioProjectInput {
  return {
    goalKey: "g",
    goalTitle: "hedef",
    dataSource: "mssql:CompanyGoal",
    openChildCount: 0,
    lastAgentResultAt: null,
    verifiedOpportunityCount: 0,
    opportunityId: null,
    opportunityTitle: null,
    repoVerified: false,
    recentlyServed: false,
    ...partial,
  };
}

describe("portföy Aşama A", () => {
  it("not_connected website-seo araştırmaya açık; KPI uydurmaz", () => {
    const s = scorePortfolioProject(
      base({
        slug: "synaptech",
        goalKey: "website-seo",
        dataSource: "not_connected",
      }),
      new Date("2026-11-18T18:00:00.000Z"),
    );
    expect(s.skipReason).toBeNull();
    expect(s.reasons).toContain("metric_not_connected_research_ok");
    expect(s.suggestedAssignee).toBe("seo-specialist");
    expect(s.evidenceHint).toBe("goal:website-seo");
  });

  it("kanıtsız projeyi seçmez", () => {
    const s = scorePortfolioProject(
      base({
        slug: "marivo",
        goalKey: null,
        goalTitle: null,
        dataSource: null,
        verifiedOpportunityCount: 0,
        repoVerified: false,
      }),
      new Date("2026-11-18T18:00:00.000Z"),
    );
    expect(s.skipReason).toBe("no_evidence");
  });

  it("yakın zamanda hizmet edilen OS yerine aç projeleri seçer", () => {
    const now = new Date("2026-11-18T18:00:00.000Z");
    const scored = [
      scorePortfolioProject(
        base({ slug: "synaptech-ai-os", recentlyServed: true, openChildCount: 1, lastAgentResultAt: now.toISOString() }),
        now,
      ),
      scorePortfolioProject(base({ slug: "synaptech", goalKey: "website-seo", dataSource: "not_connected" }), now),
      scorePortfolioProject(base({ slug: "subify", goalKey: "subify-quality", repoVerified: true }), now),
      scorePortfolioProject(
        base({ slug: "marivo", goalKey: "marivo-growth", verifiedOpportunityCount: 1, opportunityId: "o1" }),
        now,
      ),
    ];
    const selected = selectPortfolioProjects(scored, 3).filter((p) => p.selected).map((p) => p.slug);
    expect(selected).not.toContain("synaptech-ai-os");
    expect(selected).toEqual(expect.arrayContaining(["synaptech", "subify", "marivo"]));
  });
});

describe("persist reason codes", () => {
  it("aynı projede 3 geçerli görevi kapasite varsa düşürmez", () => {
    const items = ["a", "b", "c"].map((title) => ({
      ok: true,
      task: {
        title,
        description: title,
        projectSlug: "synaptech-ai-os" as const,
        assigneeId: "security" as const,
        priority: "medium" as const,
        acceptanceCriteria: "kanıt",
      },
    }));
    const r = decidePersistableTasks({
      items,
      selectedSlugs: ["synaptech-ai-os"],
      remainingSlots: 3,
      isDuplicateTitle: () => false,
    });
    expect(r.keep).toHaveLength(3);
    expect(r.drops).toHaveLength(0);
  });

  it("kapasite 1 ise 2 görevi queue_slot_exhausted ile raporlar", () => {
    const items = ["a", "b", "c"].map((title) => ({
      ok: true,
      task: {
        title,
        description: title,
        projectSlug: "synaptech-ai-os" as const,
        assigneeId: "security" as const,
        priority: "medium" as const,
        acceptanceCriteria: "kanıt",
      },
    }));
    const r = decidePersistableTasks({
      items,
      selectedSlugs: ["synaptech-ai-os"],
      remainingSlots: 1,
      isDuplicateTitle: () => false,
    });
    expect(r.keep).toHaveLength(1);
    expect(r.drops.filter((d) => d.reasonCode === "queue_slot_exhausted")).toHaveLength(2);
  });

  it("model atladığı seçili projeye Aşama A görevi ekler", () => {
    const selected: ScoredPortfolioProject[] = [
      {
        ...scorePortfolioProject(base({ slug: "subify", goalKey: "subify-quality" }), new Date()),
        selected: true,
      },
    ];
    const r = mergeOmittedSelectedTasks(
      [
        {
          title: "OS güvenlik",
          description: "x",
          projectSlug: "synaptech-ai-os",
          assigneeId: "security",
          priority: "medium",
          acceptanceCriteria: "y",
        },
      ],
      selected,
    );
    expect(r.filled).toEqual(["subify"]);
    expect(r.tasks.some((t) => t.projectSlug === "subify")).toBe(true);
  });
});

describe("rol kapısı CEO child", () => {
  it("ceo atamasını cto'ya çeker", () => {
    const r = reassignCeoTaskRole({
      title: "Operasyon planı",
      description: "şirket değerlendirmesi",
      projectSlug: "synaptech-ai-os",
      assigneeId: "ceo",
      priority: "medium",
      acceptanceCriteria: "kanıt",
    });
    expect(r.task.assigneeId).toBe("cto");
    expect(r.reassignedFrom).toBe("ceo");
  });
});
