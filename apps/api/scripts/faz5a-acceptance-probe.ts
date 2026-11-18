/**
 * Faz 5A kabul kanıtı — deterministik; LLM/Cloud create yok.
 * Kullanım: pnpm --filter @synaptech/api exec tsx scripts/faz5a-acceptance-probe.ts
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const base = process.env.SYNAPTECH_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:3101";
  const token = process.env.SYNAPTECH_OWNER_TOKEN;
  if (!token) throw new Error("SYNAPTECH_OWNER_TOKEN eksik");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const tickRes = await fetch(`${base}/api/autonomy/scheduler/tick`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const tick = await tickRes.json();
  if (!tickRes.ok) throw new EvidenceError("tick_failed", tick);

  const statusRes = await fetch(`${base}/api/autonomy/status`, { headers });
  const status = await statusRes.json();

  const cycleRes = await fetch(`${base}/api/autonomy/ceo/cycle`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const cycle = await cycleRes.json();

  const [opps, tasks, messages, audit] = await Promise.all([
    fetch(`${base}/api/autonomy/opportunities`, { headers }).then((r) => r.json()),
    fetch(`${base}/api/autonomy/tasks`, { headers }).then((r) => r.json()),
    fetch(`${base}/api/autonomy/messages`, { headers }).then((r) => r.json()),
    fetch(`${base}/api/audit?limit=30&category=autonomy`, { headers }).then((r) => r.json()),
  ]);

  const evidence = {
    at: new Date().toISOString(),
    phase: "5A",
    planner: status.planner,
    llmIntegrated: status.llmIntegrated,
    cloudAutoDispatch: status.cloudAutoDispatch,
    tick: {
      ok: tickRes.ok,
      ran: tick.ran,
      skipped: tick.skipped,
    },
    cycle: {
      ok: cycleRes.ok,
      planner: cycle.planner,
      parentTaskId: cycle.parentTaskId,
      subtaskId: cycle.subtaskId,
      opportunityId: cycle.opportunityId,
      messageId: cycle.messageId,
      skippedReason: cycle.skippedReason ?? null,
      opportunitiesCreated: cycle.opportunitiesCreated,
    },
    counts: status.counts,
    jobs: status.jobs,
    sampleOpportunity: (opps.opportunities ?? []).slice(0, 3).map((o: Record<string, unknown>) => ({
      id: o.id,
      title: o.title,
      projectSlug: o.projectSlug,
      verified: o.verified,
      status: o.status,
      evidenceRef: o.evidenceRef,
    })),
    sampleTasks: (tasks.tasks ?? []).slice(0, 6).map((t: Record<string, unknown>) => ({
      id: t.id,
      title: t.title,
      parentTaskId: t.parentTaskId,
      assigneeId: t.assigneeId,
      origin: t.origin,
      dispatchState: t.dispatchState,
    })),
    sampleMessages: (messages.messages ?? []).slice(0, 5).map((m: Record<string, unknown>) => ({
      id: m.id,
      from: m.fromAgentId,
      to: m.toAgentId,
      kind: m.kind,
      summary: m.summary,
    })),
    auditActions: (audit.events ?? []).map((e: { action: string }) => e.action).slice(0, 15),
  };

  const outDir = path.resolve(process.cwd(), "../../reports/qa");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "faz-5a-acceptance-evidence.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ wrote: jsonPath, ...evidence }, null, 2));
}

class EvidenceError extends Error {
  constructor(public code: string, public body: unknown) {
    super(code);
  }
}

main().catch((err) => {
  console.error(err instanceof EvidenceError ? err.code : err);
  if (err instanceof EvidenceError) console.error(JSON.stringify(err.body));
  process.exit(1);
});
