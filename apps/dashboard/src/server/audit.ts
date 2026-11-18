import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { AuditEventSchema, SubagentStateSchema, type AuditEvent } from "@synaptech/shared";

import type { ActiveSubagent, AuditSummary } from "@/lib/types";

import { FILE_NOT_FOUND, isNotFound, loadJsonFile } from "./files";
import { repoPath } from "./paths";

const AUDIT_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/** `.synaptech/audit/*.jsonl` dosyalarını (Cursor hook'larının gerçek kayıtları) en yeniden eskiye okur. */
export async function loadAuditEvents(options: { limit?: number; maxFiles?: number } = {}): Promise<AuditSummary> {
  const directory = repoPath(".synaptech", "audit");

  let names: string[];
  try {
    names = (await readdir(directory))
      .filter((name) => AUDIT_FILE_PATTERN.test(name))
      .sort()
      .reverse()
      .slice(0, options.maxFiles ?? 7);
  } catch (error) {
    if (isNotFound(error)) return { events: [], files: [], invalidLines: 0 };
    throw error;
  }

  const events: AuditEvent[] = [];
  let invalidLines = 0;

  for (const name of names) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = AuditEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) events.push(parsed.data);
        else invalidLines += 1;
      } catch {
        invalidLines += 1;
      }
    }
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    events: events.slice(0, options.limit ?? 300),
    files: names.map((name) => `.synaptech/audit/${name}`),
    invalidLines,
  };
}

/** Guard'ın tuttuğu aktif alt ajan slotları; süresi (TTL) dolan slotlar sayılmaz. */
export async function loadActiveSubagents(
  ttlMinutes: number,
  now: Date,
): Promise<{ active: ActiveSubagent[]; error?: string }> {
  const result = await loadJsonFile(".synaptech/state/subagents.json", SubagentStateSchema);
  if (!result.ok) {
    return { active: [], error: result.error === FILE_NOT_FOUND ? undefined : result.error };
  }

  const cutoff = now.getTime() - ttlMinutes * 60_000;
  return {
    active: result.data.active
      .filter((slot) => new Date(slot.startedAt).getTime() >= cutoff)
      .map((slot) => ({
        source: "cursor-hook" as const,
        id: slot.id,
        type: slot.type,
        model: slot.model,
        task: slot.task,
        startedAt: slot.startedAt,
      })),
  };
}
