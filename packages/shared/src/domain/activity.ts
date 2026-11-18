import { z } from "zod";

import { AgentIdSchema, type AgentId } from "./agents";
import { DataSourceSchema } from "./source";
import { actorLabel, type Task } from "./tasks";

export const ACTIVITY_KINDS = ["task", "approval", "agent", "security", "system"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  task: "Görev",
  approval: "Onay",
  agent: "Ajan",
  security: "Güvenlik",
  system: "Sistem",
};

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ActivityEventSchema = z.object({
  id: z.string().min(1),
  source: DataSourceSchema,
  at: z.string().min(1),
  kind: z.enum(ACTIVITY_KINDS),
  severity: z.enum(SEVERITIES),
  actorLabel: z.string(),
  agentId: AgentIdSchema.optional(),
  title: z.string(),
  detail: z.string().optional(),
  projectSlug: z.string().optional(),
  taskId: z.string().optional(),
});

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export function sortByTimeDesc<T extends { at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.at.localeCompare(a.at));
}

/** Görev geçmişini zaman çizelgesi olaylarına çevirir; her olay görevin kaynağını (source) korur. */
export function taskHistoryToActivity(
  tasks: readonly Task[],
  agentNames?: Partial<Record<AgentId, string>>,
): ActivityEvent[] {
  return tasks.flatMap((task) =>
    task.history.map((event) => ({
      id: `${task.id}:${event.id}`,
      source: task.source,
      at: event.at,
      kind: "task" as const,
      severity: event.toStatus === "failed" ? ("warning" as const) : ("info" as const),
      actorLabel: actorLabel(event.actor, agentNames),
      agentId: event.actor.kind === "agent" ? event.actor.agentId : undefined,
      title: task.title,
      detail: event.message,
      projectSlug: task.projectSlug,
      taskId: task.id,
    })),
  );
}
