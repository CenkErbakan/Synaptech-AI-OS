import { describe, expect, it } from "vitest";
import type { CeoPlan } from "@synaptech/shared";

type CeoPlanTask = CeoPlan["tasks"][number];

import {
  applyRoleGateToPlanTasks,
  pickDiversePersistable,
  reassignCeoTaskRole,
} from "../src/ai/plan-role-gate.js";

function task(partial: Partial<CeoPlanTask> & Pick<CeoPlanTask, "title" | "assigneeId" | "projectSlug">): CeoPlanTask {
  return {
    description: partial.description ?? partial.title,
    priority: "medium",
    acceptanceCriteria: partial.acceptanceCriteria ?? "Somut kabul: kanıt dosyası veya public_fetch.",
    evidenceHint: "mssql:Task",
    ...partial,
  };
}

describe("CEO rol kapısı", () => {
  it("growth-lead teknik borç görevini CTO'ya taşır", () => {
    const r = reassignCeoTaskRole(
      task({
        title: "Teknik borç: repo mimari incelemesi",
        description: "tech debt ve architecture temizliği",
        assigneeId: "growth-lead",
        projectSlug: "synaptech-ai-os",
      }),
    );
    expect(r.task.assigneeId).toBe("cto");
    expect(r.reassignedFrom).toBe("growth-lead");
  });

  it("kod geliştirme developer, test tester, reklam ads", () => {
    expect(
      reassignCeoTaskRole(
        task({
          title: "Sandbox patch ile bugfix",
          assigneeId: "growth-lead",
          projectSlug: "subify",
        }),
      ).task.assigneeId,
    ).toBe("developer");
    expect(
      reassignCeoTaskRole(
        task({
          title: "Docker test ile regresyon doğrula",
          assigneeId: "cto",
          projectSlug: "subify",
        }),
      ).task.assigneeId,
    ).toBe("tester");
    expect(
      reassignCeoTaskRole(
        task({
          title: "Google Ads kampanya taslağı",
          assigneeId: "growth-lead",
          projectSlug: "synaptech",
        }),
      ).task.assigneeId,
    ).toBe("ads-manager");
  });

  it("çeşitlilik önce farklı projeleri seçer", () => {
    const items = [
      { task: { projectSlug: "synaptech-ai-os" } },
      { task: { projectSlug: "synaptech-ai-os" } },
      { task: { projectSlug: "subify" } },
      { task: { projectSlug: "marivo" } },
    ];
    const picked = pickDiversePersistable(items, 3);
    expect(picked.map((p) => p.task.projectSlug)).toEqual([
      "synaptech-ai-os",
      "subify",
      "marivo",
    ]);
  });

  it("applyRoleGateToPlanTasks redirect kaydı üretir", () => {
    const r = applyRoleGateToPlanTasks([
      task({
        title: "Teknik borç refactor",
        assigneeId: "growth-lead",
        projectSlug: "synaptech-ai-os",
      }),
    ]);
    expect(r.tasks[0]?.assigneeId).toBe("cto");
    expect(r.redirects[0]?.from).toBe("growth-lead");
  });
});
