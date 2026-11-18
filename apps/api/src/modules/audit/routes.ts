import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../auth/context.js";
import { getPrisma } from "../../db/prisma.js";

export async function auditRoutes(app: FastifyInstance) {
  app.get("/api/audit", async (request) => {
    requireAuth(request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        category: z.string().optional(),
      })
      .parse(request.query);
    const prisma = getPrisma();
    const events = await prisma.auditLog.findMany({
      where: query.category ? { category: query.category } : undefined,
      orderBy: { at: "desc" },
      take: query.limit,
    });
    return {
      events: events.map((event) => ({
        id: event.id,
        at: event.at.toISOString(),
        category: event.category,
        action: event.action,
        actorKind: event.actorKind,
        actorAgent: event.actorAgent,
        targetType: event.targetType,
        targetId: event.targetId,
        summary: event.summary,
        // metadata kasıtlı olarak ham secret içermez (sanitize edilmiş)
        metadata: event.metadata ? JSON.parse(event.metadata) : null,
      })),
    };
  });
}
