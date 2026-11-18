import "server-only";

import { AgentFrontmatterSchema } from "@synaptech/shared";

import type { AgentDirectoryEntry, LoadResult } from "@/lib/types";

import { loadAgentRegistry } from "./config";
import { readRepoText, splitFrontmatter } from "./files";

/** Ajan kaydını `.cursor/agents/<id>.md` frontmatter'ıyla birleştirir; model ve readonly bilgisi dosyadan okunur. */
export async function loadAgentDirectory(): Promise<LoadResult<AgentDirectoryEntry[]>> {
  const registry = await loadAgentRegistry();
  if (!registry.ok) return registry;

  const departments = new Map(registry.data.departments.map((department) => [department.id, department.name]));

  const entries = await Promise.all(
    registry.data.agents.map(async (agent): Promise<AgentDirectoryEntry> => {
      const definitionPath = `.cursor/agents/${agent.id}.md`;
      const base = { ...agent, departmentName: departments.get(agent.department) ?? agent.department };
      const text = await readRepoText(definitionPath);

      if (text === null) {
        return {
          ...base,
          definition: { path: definitionPath, exists: false, frontmatter: null, error: "Tanım dosyası yok." },
        };
      }

      const parsed = AgentFrontmatterSchema.safeParse(splitFrontmatter(text).data);
      if (!parsed.success) {
        return {
          ...base,
          definition: { path: definitionPath, exists: true, frontmatter: null, error: "Frontmatter geçersiz." },
        };
      }

      return {
        ...base,
        definition: {
          path: definitionPath,
          exists: true,
          frontmatter: parsed.data,
          error: parsed.data.name === agent.id ? undefined : "Frontmatter adı dosya adıyla eşleşmiyor.",
        },
      };
    }),
  );

  return { ok: true, data: entries, path: registry.path };
}
