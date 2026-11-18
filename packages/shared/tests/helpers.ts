import { createTask, type TaskContext } from "../src/domain/task-machine";
import type { Actor, Task } from "../src/domain/tasks";

export const NOW = new Date("2026-11-17T12:00:00.000Z");

export function makeContext(overrides: Partial<TaskContext> = {}): TaskContext {
  let sequence = 0;
  return {
    actor: { kind: "user" },
    now: NOW,
    killSwitchEnabled: false,
    maxRetries: 2,
    newId: () => `id-${++sequence}`,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}, actor: Actor = { kind: "user" }): Task {
  const task = createTask(
    { title: "Örnek görev", projectSlug: "synaptech", assignee: "developer", initialStatus: "planned" },
    { ...makeContext({ actor }), source: "demo" },
  );
  return { ...task, ...overrides };
}
