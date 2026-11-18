import type { AgentId, AgentStatus } from "./agents";
import { isActiveStatus, type Task } from "./tasks";

const COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AgentStatusResult {
  status: AgentStatus;
  basis: "disabled" | "tasks" | "cursor-hook" | "no-records";
  currentTaskId?: string;
  detail?: string;
}

/** DEMO görünümü: durum yalnızca (DEMO) görev kayıtlarından türetilir. */
export function deriveAgentStatusFromTasks(
  agentId: AgentId,
  tasks: readonly Task[],
  options: { enabled: boolean; now: Date },
): AgentStatusResult {
  if (!options.enabled) return { status: "disabled", basis: "disabled" };

  const mine = tasks.filter((task) => task.assignee === agentId && task.status !== "cancelled");
  if (mine.length === 0) return { status: "idle", basis: "no-records" };

  const working = mine.find((task) => isActiveStatus(task.status) && !task.paused);
  if (working) return { status: "working", basis: "tasks", currentTaskId: working.id };

  const awaiting = mine.find((task) => task.status === "awaiting_approval");
  if (awaiting) return { status: "awaiting_approval", basis: "tasks", currentTaskId: awaiting.id };

  const latest = [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latest?.status === "failed") {
    return { status: "error", basis: "tasks", currentTaskId: latest.id };
  }
  if (latest?.status === "done") {
    const finished = new Date(latest.finishedAt ?? latest.updatedAt).getTime();
    if (options.now.getTime() - finished <= COMPLETED_WINDOW_MS) {
      return { status: "completed", basis: "tasks", currentTaskId: latest.id };
    }
  }
  return { status: "idle", basis: "tasks" };
}

export interface RealAgentSignals {
  enabled: boolean;
  activeSubagents: ReadonlyArray<{ type: string; startedAt: string; task?: string }>;
  lastStop?: { status: "completed" | "error" | "aborted"; at: string };
}

/** Gerçek görünüm: durum yalnızca Cursor hook kayıtlarından türetilir; tanım dosyası tek başına "çalışıyor" demek değildir. */
export function deriveAgentStatusFromSignals(
  agentId: AgentId,
  signals: RealAgentSignals,
  now: Date,
): AgentStatusResult {
  if (!signals.enabled) return { status: "disabled", basis: "disabled" };

  const active = signals.activeSubagents.find((subagent) => subagent.type === agentId);
  if (active) return { status: "working", basis: "cursor-hook", detail: active.task };

  if (signals.lastStop) {
    const recent = now.getTime() - new Date(signals.lastStop.at).getTime() <= COMPLETED_WINDOW_MS;
    if (recent && signals.lastStop.status === "error") return { status: "error", basis: "cursor-hook" };
    if (recent && signals.lastStop.status === "completed") return { status: "completed", basis: "cursor-hook" };
    return { status: "idle", basis: "cursor-hook" };
  }

  return { status: "idle", basis: "no-records" };
}
