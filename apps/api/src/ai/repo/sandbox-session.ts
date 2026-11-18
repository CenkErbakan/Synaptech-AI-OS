import fs from "node:fs";
import { getPrisma } from "../../db/prisma.js";

export type SandboxSessionMeta = {
  root: string;
  projectSlug: string;
  headSha: string | null;
  appliedPaths: string[];
  diffDigest: string;
  createdAt: string;
};

export function parseSandboxSessionFromExecutionResult(
  executionResult: string | null | undefined,
): SandboxSessionMeta | null {
  if (!executionResult) return null;
  try {
    const parsed = JSON.parse(executionResult) as { sandbox?: SandboxSessionMeta };
    if (!parsed.sandbox?.root) return null;
    if (!fs.existsSync(parsed.sandbox.root)) return null;
    return parsed.sandbox;
  } catch {
    return null;
  }
}

/** Aynı parent altındaki developer görevinin sandbox oturumunu bul. */
export async function findLinkedDeveloperSandbox(
  parentTaskId: string | null | undefined,
): Promise<SandboxSessionMeta | null> {
  if (!parentTaskId) return null;
  const prisma = getPrisma();
  const siblings = await prisma.task.findMany({
    where: {
      parentTaskId,
      assigneeId: "developer",
      source: "real",
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { executionResult: true },
  });
  for (const row of siblings) {
    const session = parseSandboxSessionFromExecutionResult(row.executionResult);
    if (session) return session;
  }
  return null;
}
