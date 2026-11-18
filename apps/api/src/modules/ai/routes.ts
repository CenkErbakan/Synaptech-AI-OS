import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { evaluateCloudBudgetGate } from "../../ai/budget-gate.js";
import {
  prepareGrowthAiHook,
  runAiCeoPipeline,
} from "../../ai/execution-adapter.js";
import { runLocalCeoPilotEvaluation } from "../../ai/local-ceo-pilot.js";
import {
  getLocalAgentExecutionStatus,
  runLocalAgentExecutionPass,
} from "../../ai/local-agent-execution.js";
import { listProjectRepoBindings } from "../../ai/repo/project-repo-registry.js";
import { getRepositoryToolAdapter } from "../../ai/repo/repository-tool-adapter.js";
import { SANDBOX_COMMAND_ALLOWLIST } from "../../ai/repo/sandbox-runner.js";
import { resolveActiveModelProvider } from "../../ai/providers/registry.js";
import { getEnv } from "../../lib/env.js";
import { validationError } from "../../lib/errors.js";

export async function aiRoutes(app: FastifyInstance) {
  app.get("/api/ai/status", async (request) => {
    requireAuth(request);
    const env = getEnv();
    const resolved = await resolveActiveModelProvider();
    const gate = evaluateCloudBudgetGate();
    const caps = resolved.provider.capabilities();
    return {
      source: "api" as const,
      phase: "5E",
      faz5eCompleteClaim: false,
      note: "Gerçek AI yürütmesi ayrıca doğrulanmadan Faz 5E tamamlandı denmez.",
      localAiPilot: env.LOCAL_AI_PILOT,
      schedulerAiCeoMode: env.SCHEDULER_AI_CEO_MODE,
      schedulerAiCeoMaxPerDay: env.SCHEDULER_AI_CEO_MAX_PER_DAY,
      localAgentExecutionMode: env.LOCAL_AGENT_EXECUTION_MODE,
      localAgentExecutionMaxPerDay: env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY,
      agentRepoToolsMode: env.AGENT_REPO_TOOLS_MODE,
      agentSandboxMode: env.AGENT_SANDBOX_MODE,
      modelProvider: {
        id: resolved.provider.id,
        mode: resolved.mode,
        displayName: resolved.provider.displayName,
        realAiAvailable: resolved.realAiAvailable,
        localUnavailable: Boolean(resolved.localUnavailable),
        silentMockFallback: false,
        capabilities: caps,
        probeNote: resolved.note,
        configuredModel: env.LOCAL_LLM_MODEL,
        configuredBaseUrl: env.LOCAL_LLM_BASE_URL ?? null,
      },
      cursorCloud: {
        role: "coding_agent_only",
        isModelProvider: false,
        autoDispatchAllowed: gate.cloudAutoDispatchAllowed,
        gateReason: gate.reason,
        remainingUsageKnown: false,
        liveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
      },
      channels: {
        deterministic: "always",
        mock_llm: "safe_test",
        local_llm: "owner_machine_ollama",
        cloud_coding: "blocked_without_cost_gate",
      },
    };
  });

  app.post("/api/ai/ceo/pipeline", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        forceChannel: z.enum(["deterministic", "mock_llm", "local_llm"]).optional(),
        opportunityId: z.string().uuid().optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) throw validationError("Geçersiz gövde.", body.error.flatten());
    // cloud_coding force yasak — bu endpoint ModelProvider pipeline
    const result = await runAiCeoPipeline({
      forceChannel: body.data.forceChannel ?? "mock_llm",
      opportunityId: body.data.opportunityId,
      idempotencySuffix: `api-${Date.now()}`,
    });
    return { source: "api" as const, ...result };
  });

  app.get("/api/ai/growth-hooks", async (request) => {
    requireAuth(request);
    const [seo, content, research] = await Promise.all([
      prepareGrowthAiHook("seo"),
      prepareGrowthAiHook("content"),
      prepareGrowthAiHook("research"),
    ]);
    return {
      source: "api" as const,
      publishAllowed: false,
      customerMessageAllowed: false,
      hooks: { seo, content, research },
    };
  });

  /** Yerel AI CEO pilotu — Owner + LOCAL_AI_PILOT; Cloud yok; onaylı model sonrası */
  app.post("/api/ai/local-ceo/pilot", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        chatMessage: z.string().min(1).max(2000).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) throw validationError("Geçersiz gövde.", body.error.flatten());
    const result = await runLocalCeoPilotEvaluation({
      chatMessage: body.data.chatMessage,
    });
    return result;
  });

  /** CEO dışı yerel ajan yürütme durumu (gerçek / mock / bekleyen ayrımı) */
  app.get("/api/ai/agents/execution-status", async (request) => {
    requireAuth(request);
    const status = await getLocalAgentExecutionStatus();
    return { source: "api" as const, ...status };
  });

  /** Repo araç / sandbox / bağ durumu — gerçek işlem başlatmaz. */
  app.get("/api/ai/agents/repo-tools-status", async (request) => {
    requireAuth(request);
    const env = getEnv();
    const modes = getRepositoryToolAdapter().getModes();
    const bindings = await listProjectRepoBindings();
    return {
      source: "api" as const,
      continuousAutomation: false,
      cloudAutoDispatch: false,
      agentRepoToolsMode: env.AGENT_REPO_TOOLS_MODE,
      agentSandboxMode: env.AGENT_SANDBOX_MODE,
      modes,
      sandboxAllowlist: SANDBOX_COMMAND_ALLOWLIST.map((c) => ({
        id: c.id,
        argv: [...c.argv],
        description: c.description,
        isolatedAllowed: c.isolatedAllowed,
      })),
      bindings: bindings.map((b) => ({
        projectSlug: b.projectSlug,
        githubRepoUrl: b.githubRepoUrl,
        localReadRoot: b.localReadRoot ? "[set]" : null,
        verified: b.verified,
        verifiedBy: b.verifiedBy,
        source: b.source,
        blockedReason: b.blockedReason,
        readOnly: b.readOnly,
        writeAllowed: b.writeAllowed,
        evidenceNotes: b.evidenceNotes,
      })),
      note: "Doğrulanmamış bağlarda araçlar kapalı. Push/PR/Cloud otomatik değil.",
    };
  });

  /**
   * Owner tetikli yerel ajan pass — sürekli otomasyon değil.
   * LOCAL_AGENT_EXECUTION_MODE=off iken boş döner; local için ayrı onay gerekir.
   */
  app.post("/api/ai/agents/execute", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        limit: z.number().int().positive().max(8).optional(),
        taskIds: z.array(z.string().uuid()).max(8).optional(),
        agentIds: z
          .array(
            z.enum([
              "cto",
              "developer",
              "tester",
              "security",
              "growth-lead",
              "seo-specialist",
              "content-manager",
              "ads-manager",
            ]),
          )
          .max(8)
          .optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) throw validationError("Geçersiz gövde.", body.error.flatten());
    const result = await runLocalAgentExecutionPass(body.data);
    return { source: "api" as const, continuousAutomation: false, ...result };
  });
}
