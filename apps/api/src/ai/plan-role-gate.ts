import type { AgentId, CeoPlan } from "@synaptech/shared";

type CeoPlanTask = CeoPlan["tasks"][number];

const TECH_DEBT =
  /\b(teknik borç|tech debt|refactor|mimari|architecture|kod kalitesi|dependency|bağımlılık|repo incele|structure)\b/i;
const CODE_DEV = /\b(implement|geliştir|patch|bugfix|feature|kod yaz|sandbox)\b/i;
const TEST = /\b(test|qa|regresyon|doğrula|vitest|docker test)\b/i;
const SEC = /\b(güvenlik|security|cve|secret|authn|authz|sızma)\b/i;
const GROWTH = /\b(müşteri|lead|pazar|büyüme|satış adayı|outreach|segment)\b/i;
const SEO = /\b(seo|organik|sitemap|meta etiket|anahtar kelime)\b/i;
const CONTENT = /\b(blog|içerik|content draft|makale)\b/i;
const ADS = /\b(reklam|kampanya|ads|meta ads|google ads|bütçe taslağı)\b/i;

/**
 * Model yanlış ajan seçerse güvenli yeniden yönlendirme.
 * Growth'a teknik borç verilmez. Ajan adı uydurulmaz.
 */
export function reassignCeoTaskRole(task: CeoPlanTask): {
  task: CeoPlanTask;
  reassignedFrom: string | null;
  reason: string | null;
} {
  const blob = `${task.title}\n${task.description}\n${task.acceptanceCriteria}`;
  let want: AgentId | null = null;
  if (GROWTH.test(blob) && !TECH_DEBT.test(blob)) want = "growth-lead";
  else if (ADS.test(blob)) want = "ads-manager";
  else if (CONTENT.test(blob)) want = "content-manager";
  else if (SEO.test(blob)) want = "seo-specialist";
  else if (SEC.test(blob)) want = "security";
  else if (TEST.test(blob) && !CODE_DEV.test(blob)) want = "tester";
  else if (CODE_DEV.test(blob)) want = "developer";
  else if (TECH_DEBT.test(blob)) want = "cto";

  if (task.assigneeId === "growth-lead" && TECH_DEBT.test(blob) && !GROWTH.test(blob)) {
    want = "cto";
  }

  if (!want || want === task.assigneeId) {
    return { task, reassignedFrom: null, reason: null };
  }
  return {
    task: { ...task, assigneeId: want },
    reassignedFrom: task.assigneeId,
    reason: `role_gate:${task.assigneeId}->${want}`,
  };
}

export function pickDiversePersistable<T extends { task: { projectSlug: string } }>(
  items: T[],
  max: number,
): T[] {
  const cap = Math.max(1, Math.min(8, max));
  const chosen: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (chosen.length >= cap) break;
    if (seen.has(item.task.projectSlug)) continue;
    seen.add(item.task.projectSlug);
    chosen.push(item);
  }
  for (const item of items) {
    if (chosen.length >= cap) break;
    if (chosen.includes(item)) continue;
    chosen.push(item);
  }
  return chosen;
}

export function applyRoleGateToPlanTasks(tasks: CeoPlanTask[]): {
  tasks: CeoPlanTask[];
  redirects: Array<{ title: string; from: string; to: string; reason: string }>;
} {
  const redirects: Array<{ title: string; from: string; to: string; reason: string }> = [];
  const out = tasks.map((t) => {
    const r = reassignCeoTaskRole(t);
    if (r.reassignedFrom && r.reason) {
      redirects.push({
        title: t.title,
        from: r.reassignedFrom,
        to: r.task.assigneeId,
        reason: r.reason,
      });
    }
    return r.task;
  });
  return { tasks: out, redirects };
}
