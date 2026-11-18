import { APPROVAL_TYPES, RISK_LEVELS } from "@synaptech/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { actorFromPrincipal, requireAuth, requireOwner } from "../../auth/context.js";
import {
  bumpApprovalVersion,
  createApproval,
  decideRealApproval,
  listApprovals,
} from "../../engines/approval-engine.js";
import { validationError } from "../../lib/errors.js";

export async function approvalRoutes(app: FastifyInstance) {
  app.get("/api/approvals", async (request) => {
    requireAuth(request);
    const approvals = await listApprovals();
    return { approvals };
  });

  app.post("/api/approvals", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        type: z.enum(APPROVAL_TYPES),
        requestedBy: z.string().min(1),
        projectSlug: z.string().min(1),
        taskId: z.string().optional(),
        title: z.string().min(1).max(200),
        description: z.string(),
        changeSummary: z.string(),
        risk: z.enum(RISK_LEVELS),
        subjectKind: z.enum(["git_commit", "content_sha256", "payload_sha256"]),
        subjectRef: z.string().min(1),
        subjectVersion: z.string().min(1),
        expiresAt: z.string().datetime({ offset: true }).optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Onay talebi geçersiz.", body.error.flatten());
    const approval = await createApproval(body.data);
    return { approval };
  });

  app.post<{ Params: { id: string } }>("/api/approvals/:id/decide", async (request) => {
    const principal = requireOwner(request);
    const body = z
      .object({
        decision: z.enum(["approved", "rejected"]),
        note: z.string().max(1000).optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Karar gövdesi geçersiz.", body.error.flatten());
    const result = await decideRealApproval(
      request.params.id,
      body.data.decision,
      actorFromPrincipal(principal),
      body.data.note,
    );
    return result;
  });

  app.post<{ Params: { id: string } }>("/api/approvals/:id/bump-version", async (request) => {
    requireOwner(request);
    const body = z.object({ version: z.string().min(1) }).safeParse(request.body);
    if (!body.success) throw validationError("Sürüm gerekli.");
    const approval = await bumpApprovalVersion(request.params.id, body.data.version);
    return { approval };
  });
}
