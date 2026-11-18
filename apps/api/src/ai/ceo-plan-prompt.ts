import { createHash } from "node:crypto";

import type { PlanRequest } from "./model-provider.js";

/** Compact JSON contract — uzun serbest metin üretmeyi keser. */
export const CEO_PLAN_JSON_CONTRACT = [
  "Yalnızca JSON. Alanlar:",
  "summary string<=240;",
  "goalsAddressed string[]<=8;",
  "tasks 1..5 (8 zorunlu değil) {title<=80, description<=220, projectSlug, assigneeId, priority, acceptanceCriteria<=180, evidenceHint?<=120};",
  "risks string[]<=5 her biri <=120;",
  "requiresOwnerApproval=true; estimatedAiCost=local_compute.",
  "projectSlug: synaptech-ai-os|synaptech|subify|marivo.",
  "assigneeId: cto|developer|tester|security|growth-lead|seo-specialist|content-manager|ads-manager (ceo yazma).",
  "priority: low|medium|high.",
    "Kanıtsız proje/görev yok. Uydurma metrik yok.",
    "Eski Faz/test/mock/coordination Task veya eski GrowthScan kullanma.",
].join(" ");

export function compactPlanRequest(request: PlanRequest): PlanRequest {
  return {
    goals: request.goals.slice(0, 4).map((g) => ({
      goalKey: String(g.goalKey).slice(0, 64),
      projectSlug: g.projectSlug,
      title: String(g.title).slice(0, 80),
      dataSource: String(g.dataSource).slice(0, 64),
    })),
    opportunities: request.opportunities.slice(0, 4).map((o) => ({
      id: o.id,
      title: String(o.title).slice(0, 80),
      projectSlug: o.projectSlug,
      evidenceRef: o.evidenceRef ? String(o.evidenceRef).slice(0, 80) : null,
    })),
    openTaskCount: request.openTaskCount,
    instruction: request.instruction ? String(request.instruction).slice(0, 700) : undefined,
  };
}

export function buildCeoPlanPrompt(request: PlanRequest): { prompt: string; promptChars: number } {
  const compact = compactPlanRequest(request);
  const prompt = [
    "Sen SynapTech AI OS yerel AI CEO'susun. Yalnızca JSON döndür. Uzun paragraf yazma.",
    "Onay/kill switch/Cloud/bütçe/git_push/müşteri ileti önerme.",
    CEO_PLAN_JSON_CONTRACT,
    "Bağlam (kısa MSSQL özeti):",
    JSON.stringify({
      goals: compact.goals,
      opportunities: compact.opportunities,
      openTaskCount: compact.openTaskCount,
      instruction: compact.instruction ?? null,
    }),
  ].join("\n");
  return { prompt, promptChars: prompt.length };
}

export function clipIdempotencyKey(raw: string, max = 128): string {
  if (raw.length <= max) return raw;
  const h = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const keep = max - 1 - h.length;
  return `${raw.slice(0, Math.max(8, keep))}:${h}`.slice(0, max);
}
