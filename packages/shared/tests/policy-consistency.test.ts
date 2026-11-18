import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import {
  AGENT_IDS,
  AgentFrontmatterSchema,
  AgentRegistrySchema,
  AutomationsConfigSchema,
  BudgetPolicySchema,
  EXPECTED_READONLY,
  GuardPolicySchema,
} from "../src";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function splitFrontmatter(text: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  return parseYaml(match[1] ?? "");
}

describe("politika tutarlılığı", () => {
  it("budget-policy eşzamanlılık değerleri policy.json ile aynıdır", () => {
    const budget = BudgetPolicySchema.parse(parseYaml(read("config/budget-policy.yaml")));
    const policy = GuardPolicySchema.parse(JSON.parse(read(".cursor/hooks/policy.json")));
    expect(policy.subagents.maxConcurrent).toBe(budget.concurrency.max_concurrent_subagents);
    expect(policy.subagents.slotTtlMinutes).toBe(budget.concurrency.subagent_slot_ttl_minutes);
    expect(policy.subagents.maxLaunchesPerConversation).toBe(
      budget.concurrency.max_subagent_launches_per_conversation,
    );
  });

  it("dokuz ajan dosyası agents.yaml ve EXPECTED_READONLY ile eşleşir", () => {
    const registry = AgentRegistrySchema.parse(parseYaml(read("config/agents.yaml")));
    expect(registry.agents.map((agent) => agent.id).sort()).toEqual([...AGENT_IDS].sort());

    for (const id of AGENT_IDS) {
      const text = read(`.cursor/agents/${id}.md`);
      const parsed = AgentFrontmatterSchema.parse(splitFrontmatter(text));
      expect(parsed.name).toBe(id);
      expect(parsed.readonly ?? false).toBe(EXPECTED_READONLY[id]);
    }

    const files = readdirSync(path.join(root, ".cursor/agents")).filter((name) => name.endsWith(".md"));
    expect(files).toHaveLength(9);
  });

  it("tüm otomasyonlar kapalıdır", () => {
    const automations = AutomationsConfigSchema.parse(parseYaml(read("config/automations.yaml")));
    expect(automations.global.enabled).toBe(false);
    expect(automations.automations).toHaveLength(7);
    expect(automations.automations.every((item) => item.enabled === false)).toBe(true);
  });
});
