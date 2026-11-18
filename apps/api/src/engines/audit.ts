import { getPrisma } from "../db/prisma.js";

const SECRET_KEYS = /password|token|secret|authorization|api[_-]?key|credential/i;

type ActorKind = "owner" | "agent" | "system";

export function sanitizeMetadata(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEYS.test(key)) {
      cleaned[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      cleaned[key] = `${value.slice(0, 500)}…`;
      continue;
    }
    cleaned[key] = value;
  }
  return JSON.stringify(cleaned);
}

export async function writeAudit(input: {
  category: string;
  action: string;
  actorKind: ActorKind | "owner";
  actorAgent?: string;
  userId?: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const prisma = getPrisma();
  const actorKind = (input.actorKind === "owner" ? "owner" : input.actorKind) as ActorKind;
  await prisma.auditLog.create({
    data: {
      category: input.category,
      action: input.action,
      actorKind,
      actorAgent: input.actorAgent,
      userId: input.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      summary: input.summary.slice(0, 1000),
      metadata: sanitizeMetadata(input.metadata),
    },
  });
}
