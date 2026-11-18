import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { buildCommandCenter } from "../../engines/command-center.js";
import { evaluateGithubWrite, prepareGithubWrite } from "../../engines/github-write-adapter.js";
import { listOwnerDecisionQueue } from "../../engines/owner-decision-queue.js";
import { DEFAULT_OWNER_GRANTS, readOwnerGrants, writeOwnerGrants } from "../../engines/owner-grants.js";
import { readOperationEpoch, startOperationEpoch } from "../../engines/operation-epoch.js";
import { readDeferredLlmQueue } from "../../engines/deferred-llm-queue.js";
import { getEnv } from "../../lib/env.js";
import { validationError } from "../../lib/errors.js";

export async function opsRoutes(app: FastifyInstance) {
  app.get("/api/owner/decision-queue", async (request) => {
    requireAuth(request);
    return listOwnerDecisionQueue();
  });

  app.get("/api/ops/command-center", async (request) => {
    requireAuth(request);
    return buildCommandCenter();
  });

  app.get("/api/ops/grants", async (request) => {
    requireAuth(request);
    const values = await readOwnerGrants();
    return { source: "api" as const, values, defaults: DEFAULT_OWNER_GRANTS };
  });

  app.patch("/api/ops/grants", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        githubRepoCreate: z.boolean().optional(),
        githubPushDraftPr: z.boolean().optional(),
        customerOutreach: z.boolean().optional(),
        productionDeploy: z.boolean().optional(),
        financialSpend: z.boolean().optional(),
        permanentLocalAutonomy: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Yetki gövdesi geçersiz.", body.error.flatten());
    const values = await writeOwnerGrants(body.data, "owner");
    return { source: "api" as const, values };
  });

  app.get("/api/ops/epoch", async (request) => {
    requireAuth(request);
    return { source: "api" as const, epoch: await readOperationEpoch() };
  });

  app.post("/api/ops/epoch", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        id: z.string().min(3).max(64),
        note: z.string().max(400).optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Epoch gövdesi geçersiz.", body.error.flatten());
    const epoch = await startOperationEpoch({ id: body.data.id, note: body.data.note, actor: "owner" });
    return { source: "api" as const, epoch, deletedRows: 0 };
  });

  app.get("/api/ops/local-runtime", async (request) => {
    requireAuth(request);
    const env = getEnv();
    const grants = await readOwnerGrants();
    return {
      source: "api" as const,
      pcRequiredForLocalAi: true,
      cloudFallback: false,
      paidApiFallback: false,
      note: "PC veya API kapalıyken yerel Qwen çalışmaz. İşler kuyrukta bekler; Cloud'a geçilmez.",
      githubWriteMode: env.GITHUB_WRITE_MODE,
      githubWrite: evaluateGithubWrite(
        { taskId: "status", projectSlug: "synaptech-ai-os", verifiedRepo: true },
        grants,
        env.GITHUB_WRITE_MODE,
      ),
      deferred: await readDeferredLlmQueue(),
      concurrentLocalLlmCalls: 1,
      openTaskCap: env.LOCAL_OPS_OPEN_TASK_CAP,
      unlimitedDaily: env.LOCAL_OPS_UNLIMITED_DAILY,
      ceoMinIntervalMs: env.NODE_ENV === "test" ? 0 : env.LOCAL_OPS_CEO_MIN_INTERVAL_MS,
      onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
      cloudLiveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
      envFileKeys: (await import("../../lib/env-file-keys.js")).diffEnvFileVsRuntime(),
    };
  });

  app.post("/api/ops/github/prepare", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        taskId: z.string().min(1),
        projectSlug: z.string().min(1),
        verifiedRepo: z.boolean(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("GitHub prepare gövdesi geçersiz.", body.error.flatten());
    return { source: "api" as const, ...(await prepareGithubWrite(body.data)) };
  });

  app.get("/api/ops/github/status", async (request) => {
    requireAuth(request);
    const { githubWriteStatus } = await import("../../engines/github-rest.js");
    return { source: "api" as const, ...githubWriteStatus() };
  });

  app.post("/api/ops/github/execute", async (request) => {
    requireOwner(request);
    const { executeGithubOp } = await import("../../engines/github-rest.js");
    const body = z
      .object({
        op: z.enum(["create_repo", "push_branch", "open_draft_pr"]),
        owner: z.string().min(1),
        repo: z.string().min(1),
        branch: z.string().min(1),
        title: z.string().optional(),
        body: z.string().optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("GitHub execute gövdesi geçersiz.", body.error.flatten());
    return { source: "api" as const, ...(await executeGithubOp(body.data)) };
  });

  app.post("/api/ops/outreach/send", async (request) => {
    requireOwner(request);
    const { sendCustomerOutreach } = await import("../../engines/outreach-adapter.js");
    const body = z
      .object({
        leadId: z.string().min(1),
        companyName: z.string().min(1),
        to: z.string().min(3),
        subject: z.string().min(1),
        body: z.string().min(1),
        notes: z.string().optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw validationError("Outreach gövdesi geçersiz.", body.error.flatten());
    return { source: "api" as const, ...(await sendCustomerOutreach(body.data)) };
  });
}
