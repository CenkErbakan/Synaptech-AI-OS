import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "./audit.js";

export const DEFERRED_LLM_KEY = "deferred_llm_queue";
export const CEO_EVENT_PENDING_KEY = "ceo_event_pending";

export type DeferredLlmJob = {
  id: string;
  kind: "ceo_cycle" | "agent_pass";
  reason: string;
  createdAt: string;
};

export async function readDeferredLlmQueue(): Promise<DeferredLlmJob[]> {
  const row = await getPrisma().systemSetting.findUnique({ where: { key: DEFERRED_LLM_KEY } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as DeferredLlmJob[];
    return Array.isArray(parsed) ? parsed.slice(0, 100) : [];
  } catch {
    return [];
  }
}

async function writeQueue(jobs: DeferredLlmJob[]) {
  await getPrisma().systemSetting.upsert({
    where: { key: DEFERRED_LLM_KEY },
    create: { key: DEFERRED_LLM_KEY, value: JSON.stringify(jobs), updatedBy: "system" },
    update: { value: JSON.stringify(jobs), updatedBy: "system", updatedAt: new Date() },
  });
}

/** Ollama yok / PC kapalı — Cloud'a düşmeden kuyruğa al. */
export async function enqueueDeferredLlm(job: Omit<DeferredLlmJob, "createdAt">): Promise<void> {
  const jobs = await readDeferredLlmQueue();
  if (jobs.some((j) => j.id === job.id && j.kind === job.kind)) return;
  jobs.push({ ...job, createdAt: new Date().toISOString() });
  await writeQueue(jobs.slice(-80));
  await writeAudit({
    category: "autonomy",
    action: "ops.llm_deferred",
    actorKind: "system",
    summary: `Yerel LLM kuyruğa alındı: ${job.kind} (${job.reason})`,
    metadata: { ...job, cloudFallback: false, realAiExecution: false },
  });
}

export async function setCeoEventPending(pending: boolean): Promise<void> {
  await getPrisma().systemSetting.upsert({
    where: { key: CEO_EVENT_PENDING_KEY },
    create: { key: CEO_EVENT_PENDING_KEY, value: pending ? "1" : "0", updatedBy: "system" },
    update: { value: pending ? "1" : "0", updatedBy: "system", updatedAt: new Date() },
  });
}

export async function isCeoEventPending(): Promise<boolean> {
  const row = await getPrisma().systemSetting.findUnique({ where: { key: CEO_EVENT_PENDING_KEY } });
  return row?.value === "1";
}
