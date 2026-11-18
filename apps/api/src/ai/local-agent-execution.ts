import { createHash, randomUUID } from "node:crypto";
import { AgentWorkResultSchema, type AgentWorkResult } from "@synaptech/shared";

import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "../engines/audit.js";
import { getKillSwitch } from "../engines/kill-switch.js";
import { killSwitchActive, integrationUnavailable } from "../lib/errors.js";
import { getEnv } from "../lib/env.js";
import { getAgentRoleConfig } from "./agent-roles.js";
import {
  acquireLocalLlmCallLease,
  acquireTaskExecutionLease,
  assertLocalAgentExecutionDailyBudget,
  assertPerAgentDailyBudget,
  releaseLocalLlmCallLease,
  releaseTaskExecutionLease,
} from "./llm-call-guard.js";
import { isRealAiCompletion } from "./model-provider.js";
import { buildQuotaAuditMeta } from "./llm-quota.js";
import { getModelProvider, requireLocalModelProvider } from "./providers/registry.js";
import { verifyAcceptanceIndependently } from "./repo/acceptance-verifier.js";
import { getRepositoryToolAdapter } from "./repo/repository-tool-adapter.js";
import { applySandboxPatches } from "./repo/sandbox-patch.js";
import {
  materializeSandboxCopy,
  runAllowlistedSandboxCommand,
  type SandboxCommandId,
} from "./repo/sandbox-runner.js";
import { findLinkedDeveloperSandbox } from "./repo/sandbox-session.js";

export type AgentExecutionChannel = "off" | "mock_llm" | "local_llm" | "pending" | "blocked";

export type LocalAgentExecutionItemResult = {
  taskId: string;
  assigneeId: string;
  channel: AgentExecutionChannel;
  realAiExecution: boolean;
  status: string;
  skippedReason?: string;
  acceptanceMet?: boolean;
  codeChangeApplied?: boolean;
  isDepartmentHandoff: boolean;
  modelId: string | null;
  durationMs: number | null;
  messageId: string | null;
};

/**
 * CEO dışı yerel ajan yürütme — varsayılan kapalı.
 * Arşivli görev yok; çift worker lease; max 1 Ollama; Cloud yok.
 */
export async function runLocalAgentExecutionPass(input?: {
  limit?: number;
  taskIds?: string[];
  agentIds?: string[];
}): Promise<{
  mode: string;
  processed: LocalAgentExecutionItemResult[];
  cloudStarted: false;
}> {
  const env = getEnv();
  const mode = env.LOCAL_AGENT_EXECUTION_MODE;
  if (mode === "off") {
    return { mode, processed: [], cloudStarted: false };
  }

  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: yerel ajan yürütme yok.");
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    throw integrationUnavailable("Yerel ajan yürütme reddedildi: Cloud live açık olmamalı.");
  }

  if (mode === "local") {
    const { enforceAutonomyWindow } = await import("../engines/autonomy-window.js");
    const gate = await enforceAutonomyWindow();
    const { readOwnerGrants } = await import("../engines/owner-grants.js");
    const grants = await readOwnerGrants();
    if (!gate.active && !grants.permanentLocalAutonomy) {
      return { mode, processed: [], cloudStarted: false };
    }
  }

  const budget = await assertLocalAgentExecutionDailyBudget();
  if (!budget.ok) {
    return {
      mode,
      processed: [
        {
          taskId: "-",
          assigneeId: "-",
          channel: "blocked",
          realAiExecution: false,
          status: "skipped",
          skippedReason: budget.nextEligibleAt
            ? `${budget.reason};nextEligibleAt=${budget.nextEligibleAt}`
            : budget.reason,
          isDepartmentHandoff: false,
          modelId: null,
          durationMs: null,
          messageId: null,
        },
      ],
      cloudStarted: false,
    };
  }

  const prisma = getPrisma();
  const limit = Math.min(input?.limit ?? 3, 8);
  const agentFilter = input?.agentIds?.length
    ? input.agentIds
    : ["cto", "developer", "tester", "security", "growth-lead", "seo-specialist", "content-manager", "ads-manager"];

  const { epochCreatedAtFilter } = await import("../engines/operation-epoch.js");
  const epochFilter = await epochCreatedAtFilter("current");
  const candidates = await prisma.task.findMany({
    where: {
      source: "real",
      archivedAt: null,
      ...epochFilter,
      parentTaskId: { not: null },
      assigneeId: { in: agentFilter },
      status: { in: ["planned", "in_progress", "backlog"] },
      dispatchState: { in: ["ready", "not_applicable"] },
      ...(input?.taskIds?.length ? { id: { in: input.taskIds } } : {}),
      OR: [
        { executionKind: "real_ai_pending" },
        { origin: { startsWith: "scheduler-ai-ceo:" } },
        { executionKind: null },
      ],
    },
    include: { project: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: limit * 3,
  });

  // priority high first — prisma string order is not ideal; sort in memory
  const priorityRank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
  const ordered = [...candidates]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, limit);

  const processed: LocalAgentExecutionItemResult[] = [];
  const { renewLease } = await import("../engines/worker-lease.js");
  for (const task of ordered) {
    await renewLease("scheduler:tick", 5 * 60_000).catch(() => false);
    processed.push(await executeOneLocalAgentTask(task.id, mode));
  }
  return { mode, processed, cloudStarted: false };
}

export async function executeOneLocalAgentTask(
  taskId: string,
  modeOverride?: string,
): Promise<LocalAgentExecutionItemResult> {
  const env = getEnv();
  const mode = modeOverride ?? env.LOCAL_AGENT_EXECUTION_MODE;
  const prisma = getPrisma();

  const base = {
    taskId,
    isDepartmentHandoff: false,
    modelId: null as string | null,
    durationMs: null as number | null,
    messageId: null as string | null,
  };

  if (mode === "off") {
    return {
      ...base,
      assigneeId: "-",
      channel: "off",
      realAiExecution: false,
      status: "skipped",
      skippedReason: "local_agent_execution_mode_off",
    };
  }

  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task || task.source !== "real" || task.archivedAt) {
    return {
      ...base,
      assigneeId: task?.assigneeId ?? "-",
      channel: "blocked",
      realAiExecution: false,
      status: "skipped",
      skippedReason: task?.archivedAt ? "archived_task" : "task_not_found",
    };
  }

  const role = getAgentRoleConfig(task.assigneeId);
  if (!role) {
    return {
      ...base,
      assigneeId: task.assigneeId,
      channel: "blocked",
      realAiExecution: false,
      status: "skipped",
      skippedReason: task.assigneeId === "ceo" ? "ceo_self_skip" : "unknown_agent_role",
    };
  }

  // Owner yetkisi: OWNER-APPROVAL policy → çalıştırma
  if ((task.executionPolicy ?? "AUTO") === "OWNER-APPROVAL") {
    return {
      ...base,
      assigneeId: task.assigneeId,
      channel: "pending",
      realAiExecution: false,
      status: task.status,
      skippedReason: "owner_approval_required",
    };
  }

  const allowedProjects = new Set(["synaptech-ai-os", "synaptech", "subify", "marivo"]);
  if (!allowedProjects.has(task.project.slug)) {
    return {
      ...base,
      assigneeId: task.assigneeId,
      channel: "blocked",
      realAiExecution: false,
      status: task.status,
      skippedReason: "project_not_allowed",
    };
  }

  const taskLease = await acquireTaskExecutionLease(taskId, 180_000);
  if (!taskLease.acquired) {
    return {
      ...base,
      assigneeId: task.assigneeId,
      channel: "blocked",
      realAiExecution: false,
      status: task.status,
      skippedReason: `task_lease_held:${taskLease.reason ?? "held"}`,
    };
  }

  const llmLease = await acquireLocalLlmCallLease(undefined, `agent:${task.assigneeId}`);
  if (!llmLease.acquired) {
    await releaseTaskExecutionLease(taskId);
    return {
      ...base,
      assigneeId: task.assigneeId,
      channel: "blocked",
      realAiExecution: false,
      status: task.status,
      skippedReason: `llm_lease_held:${llmLease.reason ?? "held"}`,
    };
  }

  let quotaCallId: string | undefined;
  let providerInvoked = false;
  try {
    const budget = await assertLocalAgentExecutionDailyBudget();
    if (!budget.ok) {
      return {
        ...base,
        assigneeId: task.assigneeId,
        channel: "blocked",
        realAiExecution: false,
        status: task.status,
        skippedReason: budget.nextEligibleAt
          ? `${budget.reason};nextEligibleAt=${budget.nextEligibleAt}`
          : budget.reason,
      };
    }

    const perAgent = await assertPerAgentDailyBudget(role.agentId);
    if (!perAgent.ok) {
      return {
        ...base,
        assigneeId: task.assigneeId,
        channel: "blocked",
        realAiExecution: false,
        status: task.status,
        skippedReason: perAgent.nextEligibleAt
          ? `${perAgent.reason};nextEligibleAt=${perAgent.nextEligibleAt}`
          : perAgent.reason,
      };
    }

    const nextAttempts = (task.attempts ?? 0) + 1;
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "in_progress",
        dispatchState: "running",
        workflowPhase: "running",
        startedAt: task.startedAt ?? new Date(),
        blockedReason: null,
        attempts: nextAttempts,
      },
    });

    const provider =
      mode === "local" ? await requireLocalModelProvider() : getModelProvider();
    if (mode === "local") {
      const probe = await provider.probe();
      if (!probe.ok) {
        throw integrationUnavailable(`Yerel LLM erişilemez; mock yok. ${probe.message}`);
      }
    }

    const repoTools = getRepositoryToolAdapter();
    const sandboxMode = env.AGENT_SANDBOX_MODE;
    const { evaluateAutonomyPolicyGate } = await import("../engines/autonomy-policy-gate.js");
    const bindingPreview =
      role.agentId === "growth-lead"
        ? {
            mode: env.AGENT_REPO_TOOLS_MODE,
            sandboxMode,
            projectSlug: task.project.slug,
            binding: {
              projectSlug: task.project.slug,
              githubRepoUrl: null,
              localReadRoot: null,
              verified: false,
              verifiedBy: "none" as const,
              evidenceNotes: [],
              readOnly: true,
              writeAllowed: false,
              source: "none" as const,
              blockedReason: null,
            },
            toolsEnabled: true,
            evidence: [] as import("@synaptech/shared").ToolEvidenceRecord[],
            contextForModel: "Growth: repo incelemesi yok; kamu web araştırması kullanılacak.",
            filesRead: [],
            headSha: null,
          }
        : await repoTools.inspectForRole({
            projectSlug: task.project.slug,
            agentId: role.agentId,
          });
    const needsCodeTool =
      role.agentId === "developer" ||
      role.agentId === "tester" ||
      role.agentId === "cto" ||
      role.agentId === "security";
    if (needsCodeTool && !bindingPreview.toolsEnabled && env.AGENT_REPO_TOOLS_MODE !== "mock") {
      const gate = await evaluateAutonomyPolicyGate({
        agentId: role.agentId,
        action: role.agentId === "tester" ? "sandbox_test" : role.agentId === "developer" ? "sandbox_patch" : "repo_read",
        projectVerifiedRepo: false,
        sandboxMode,
      });
      if (!gate.allowed && gate.reason === "unverified_repo_tools_blocked") {
        // devam: araçlar zaten disabled; evidence blocked gelecek — fail-closed acceptance
      }
    }
    if (
      (role.agentId === "developer" || role.agentId === "tester") &&
      sandboxMode !== "off" &&
      sandboxMode !== "mock"
    ) {
      const dockerGate = await evaluateAutonomyPolicyGate({
        agentId: role.agentId,
        action: role.agentId === "tester" ? "sandbox_test" : "sandbox_patch",
        projectVerifiedRepo: bindingPreview.toolsEnabled,
        sandboxMode,
      });
      if (!dockerGate.allowed && dockerGate.reason === "docker_isolation_required") {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "planned",
            dispatchState: "blocked",
            blockedReason: "docker_isolation_required",
            workflowPhase: "failed",
          },
        });
        return {
          ...base,
          assigneeId: role.agentId,
          channel: "blocked",
          realAiExecution: false,
          status: "planned",
          skippedReason: "docker_isolation_required",
        };
      }
    }

    const toolBundle = bindingPreview;

    const evidence = [...toolBundle.evidence];
    let sandboxSession: {
      root: string;
      projectSlug: string;
      headSha: string | null;
      appliedPaths: string[];
      diffDigest: string;
      createdAt: string;
    } | null = null;
    let sandboxDiffText: string | null = null;
    let testerCommand: SandboxCommandId = "node_test";

    // Developer: izole kopya hazırla (patch LLM sonrası uygulanır)
    let developerSandboxRoot: string | null = null;
    if (
      role.agentId === "developer" &&
      sandboxMode === "isolated" &&
      toolBundle.toolsEnabled &&
      toolBundle.binding.localReadRoot
    ) {
      const copy = materializeSandboxCopy(toolBundle.binding.localReadRoot, { maxFiles: 300 });
      developerSandboxRoot = copy.sandboxRoot;
      evidence.push({
        kind: "binding_status",
        projectSlug: task.project.slug,
        summary: `sandbox_materialized files=${copy.copied} skipped=${copy.skipped.join(",")}`,
        trusted: true,
        commitSha: toolBundle.headSha,
        at: new Date().toISOString(),
      });
    }

    // Tester: linked developer sandbox veya taze kopya üzerinde allow-list test
    if (role.agentId === "tester" && (sandboxMode === "isolated" || sandboxMode === "mock")) {
      const linked = await findLinkedDeveloperSandbox(task.parentTaskId);
      let testerRoot = linked?.root ?? null;
      if (!testerRoot && toolBundle.binding.localReadRoot && sandboxMode === "isolated") {
        testerRoot = materializeSandboxCopy(toolBundle.binding.localReadRoot, {
          maxFiles: 300,
        }).sandboxRoot;
      }
      if (sandboxMode === "mock") {
        evidence.push({
          kind: "sandbox_command",
          projectSlug: task.project.slug,
          command: "mock:node --test",
          exitCode: 0,
          stdoutDigest: "mockdigest000001",
          summary: "mock sandbox test (gerçek AI değil)",
          trusted: true,
          at: new Date().toISOString(),
        });
      } else if (testerRoot) {
        // İzole: package.json scripts YASAK — yalnızca sabit node --test + allow-list dosya.
        testerCommand = "node_test";
        const { resolveAllowedTestFileInSandbox } = await import("./repo/sandbox-docker.js");
        const testRel = resolveAllowedTestFileInSandbox(testerRoot);
        if (!testRel) {
          evidence.push({
            kind: "blocked",
            projectSlug: task.project.slug,
            summary:
              "Tester: allow-list test dosyası yok (test/demo.test.js). package.json scripts kullanılmaz.",
            trusted: true,
            at: new Date().toISOString(),
          });
        } else {
          const run = await runAllowlistedSandboxCommand({
            projectSlug: task.project.slug,
            sandboxRoot: testerRoot,
            commandId: testerCommand,
            extraArgs: [testRel],
            commitSha: linked?.headSha ?? toolBundle.headSha,
            timeoutMs: 120_000,
            requireDockerIsolation: sandboxMode === "isolated",
          });
          evidence.push(run.evidence);
        }
        sandboxSession = {
          root: testerRoot,
          projectSlug: task.project.slug,
          headSha: linked?.headSha ?? toolBundle.headSha,
          appliedPaths: linked?.appliedPaths ?? [],
          diffDigest: linked?.diffDigest ?? "none",
          createdAt: new Date().toISOString(),
        };
      } else {
        evidence.push({
          kind: "blocked",
          projectSlug: task.project.slug,
          summary: "Tester: sandbox kökü yok (developer oturumu veya verified local root gerekli)",
          trusted: true,
          at: new Date().toISOString(),
        });
      }
    }

    if (role.agentId === "growth-lead") {
      const { runGrowthLeadResearch, isSelfPropertyUrl } = await import("../engines/growth-engine.js");
      const research = await runGrowthLeadResearch({ maxNewPerRun: 3 });
      const prismaLeads = getPrisma();
      const loadedLeads = research.leadIds.length
        ? await prismaLeads.lead.findMany({ where: { id: { in: research.leadIds } } })
        : await prismaLeads.lead.findMany({
            where: { verified: true, sourceKind: "public_company_page" },
            orderBy: { createdAt: "desc" },
            take: 12,
          });
      const leads = loadedLeads.filter(
        (lead) => !isSelfPropertyUrl(lead.sourceUrl ?? lead.websiteUrl ?? ""),
      );
      for (const lead of leads) {
        const url = lead.sourceUrl ?? lead.websiteUrl ?? "";
        if (!url || isSelfPropertyUrl(url)) continue;
        evidence.push({
          kind: "public_fetch",
          projectSlug: task.project.slug,
          path: url,
          summary: `${lead.companyName} · ${lead.needSignal} · fit bekleniyor`.slice(0, 500),
          trusted: lead.verified,
          at: new Date().toISOString(),
        });
      }
      if (research.failedFetches.length && evidence.every((e) => e.kind !== "public_fetch")) {
        evidence.push({
          kind: "blocked",
          projectSlug: task.project.slug,
          summary: `public_fetch başarısız: ${research.failedFetches.map((f) => f.error).join("; ")}`.slice(
            0,
            500,
          ),
          trusted: true,
          at: new Date().toISOString(),
        });
      }
    }

    if (role.agentId === "seo-specialist") {
      const { runTechnicalSeoScan } = await import("../engines/seo-engine.js");
      const scan = await runTechnicalSeoScan({ chainId: task.chainId });
      evidence.push({
        kind: "public_fetch",
        projectSlug: task.project.slug,
        path: "seo_scan",
        summary: `seo status=${scan.status} findings=${Array.isArray(scan.findings) ? scan.findings.length : 0}`.slice(0, 500),
        trusted: scan.status !== "failed",
        at: new Date().toISOString(),
      });
    }
    if (role.agentId === "content-manager") {
      const { createContentDraftsFromSeo } = await import("../engines/content-engine.js");
      const drafts = await createContentDraftsFromSeo({ chainId: task.chainId });
      evidence.push({
        kind: "repo_read",
        projectSlug: task.project.slug,
        path: "content_drafts",
        summary: `content drafts created=${drafts.created.length}`.slice(0, 500),
        trusted: true,
        at: new Date().toISOString(),
      });
    }
    if (role.agentId === "ads-manager") {
      const { createAdProposals } = await import("../engines/ads-engine.js");
      const ads = await createAdProposals({ chainId: task.chainId });
      evidence.push({
        kind: "repo_read",
        projectSlug: task.project.slug,
        path: "ads_proposals",
        summary: `ads proposals=${ads.created.length} liveLaunch=false`.slice(0, 500),
        trusted: true,
        at: new Date().toISOString(),
      });
    }

    const allowSandboxWrite =
      role.agentId === "developer" &&
      sandboxMode === "isolated" &&
      Boolean(developerSandboxRoot);

    const contextSummary = JSON.stringify({
      project: { slug: task.project.slug, name: task.project.name },
      origin: task.origin,
      executionKind: task.executionKind,
      mayApplyCodeChanges: allowSandboxWrite,
      sandboxMode,
      repoTools: {
        mode: toolBundle.mode,
        enabled: toolBundle.toolsEnabled,
        headSha: toolBundle.headSha,
        filesRead: toolBundle.filesRead.map((f) => f.path),
        evidenceKinds: evidence.map((e) => e.kind),
      },
      repoContext: toolBundle.contextForModel.slice(0, 7000),
      toolsDenied: [
        "cloud_create",
        "deploy",
        "customer_message",
        "blog_publish",
        "ad_launch",
        "budget_change",
        "set_kill_switch",
        "arbitrary_shell",
        "git_push",
        "open_pr",
        "network_fetch",
      ],
    });

    quotaCallId = randomUUID();
    const started = Date.now();
    const completion = await provider.executeAgentWork({
      agentId: role.agentId,
      systemPrompt: role.systemPrompt,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        projectSlug: task.project.slug,
        priority: task.priority,
      },
      contextSummary,
    });
    providerInvoked = true;
    const durationMs = Date.now() - started;

    const realAi = mode === "local" && isRealAiCompletion(completion);
    if (mode === "local" && !realAi) {
      throw integrationUnavailable("local ajan modunda gerçek AI yanıtı yok; mock başarı sayılmadı.");
    }

    let work: AgentWorkResult =
      completion.parsedWork ??
      AgentWorkResultSchema.parse(JSON.parse(completion.content));
    work = { ...work, codeChangeApplied: false };

    const draftDefaults: Record<string, AgentWorkResult["draftKind"]> = {
      "growth-lead": "research_brief",
      "seo-specialist": "seo_findings",
      "content-manager": "content_draft",
      "ads-manager": "ads_campaign_draft",
      security: "security_risk_review",
    };
    if (draftDefaults[role.agentId] && (!work.draftKind || work.draftKind === "none")) {
      work = { ...work, draftKind: draftDefaults[role.agentId]! };
    }
    if (draftDefaults[role.agentId]) {
      work = { ...work, requiresOwnerApproval: true, codeChangeApplied: false };
    }

    const toolPaths = evidence.filter((e) => e.kind === "repo_read" && e.path).map((e) => e.path as string);
    if (toolPaths.length > 0) {
      const footer = `\n\n[tool_paths]\n${toolPaths.join("\n")}`;
      work = {
        ...work,
        analysis: `${work.analysis ?? ""}${footer}`.slice(0, 8000),
      };
    }
    const publicUrls = evidence.filter((e) => e.kind === "public_fetch" && e.path).map((e) => e.path as string);
    if (role.agentId === "growth-lead" && publicUrls.length > 0) {
      work = {
        ...work,
        analysis: `${work.analysis ?? ""}\n\n[public_sources]\n${publicUrls.join("\n")}`.slice(0, 8000),
      };
    }
    if (role.agentId === "cto") {
      const blob = [work.summary, work.analysis, work.acceptanceNotes].join("\n");
      const claimsDefect =
        /\b(bug|defect|vulnerability|güvenlik açığı|kritik hata|teknik borç|tech debt|broken|regress)\b/i.test(
          blob,
        );
      const kind = work.findingKind ?? "none";
      if ((kind === "none" || !kind) && toolPaths.length >= 2 && !claimsDefect) {
        const dep = toolPaths.some((p) => /package\.json|pnpm-lock|csproj|requirements/i.test(p));
        work = { ...work, findingKind: dep ? "dependency_analysis" : "structure_inspection" };
      }
    }

    // Developer patch → yalnızca sandbox
    if (allowSandboxWrite && developerSandboxRoot) {
      const patchResult = applySandboxPatches({
        projectSlug: task.project.slug,
        sandboxRoot: developerSandboxRoot,
        patches: work.proposedPatches ?? [],
        commitSha: toolBundle.headSha,
      });
      evidence.push(patchResult.evidence);
      sandboxDiffText = patchResult.diffText || null;
      sandboxSession = {
        root: developerSandboxRoot,
        projectSlug: task.project.slug,
        headSha: toolBundle.headSha,
        appliedPaths: patchResult.applied.map((a) => a.path),
        diffDigest: patchResult.evidence.stdoutDigest ?? "empty",
        createdAt: new Date().toISOString(),
      };
    } else if (role.agentId === "developer" && sandboxMode === "mock") {
      evidence.push({
        kind: "sandbox_diff",
        projectSlug: task.project.slug,
        path: "src/demo.js",
        stdoutDigest: "mockdiffdigest01",
        summary: "mock sandbox_diff (gerçek AI/yazma değil)",
        trusted: true,
        at: new Date().toISOString(),
      });
    }

    const verified = verifyAcceptanceIndependently({
      agentId: role.agentId,
      work,
      evidence,
      toolsEnabled: toolBundle.toolsEnabled || sandboxMode === "mock",
    });
    work = {
      ...work,
      acceptanceMet: verified.acceptanceMet,
      codeChangeApplied: verified.codeChangeApplied,
      toolEvidenceRefs: evidence.map(
        (e) => `${e.kind}:${e.path ?? e.command ?? e.summary}`.slice(0, 500),
      ),
      acceptanceNotes: `${work.acceptanceNotes} | verify:${verified.reasons.join("; ")}`.slice(
        0,
        2000,
      ),
      evidenceUsed: [
        ...work.evidenceUsed,
        ...evidence
          .filter(
            (e) =>
              e.kind === "repo_read" ||
              e.kind === "sandbox_command" ||
              e.kind === "sandbox_diff" ||
              e.kind === "public_fetch",
          )
          .map((e) => `${e.kind}:${e.path ?? e.command ?? e.stdoutDigest ?? "x"}`),
      ].slice(0, 20),
    };

    const channel: AgentExecutionChannel = realAi ? "local_llm" : "mock_llm";
    const executionKind = realAi ? "local_llm" : "mock_llm";
    const maxRetries = env.CONTROLLED_AUTONOMY_MAX_RETRIES;
    const escalate =
      !work.acceptanceMet && nextAttempts > maxRetries;
    const nextStatus = work.acceptanceMet
      ? "done"
      : escalate
        ? "awaiting_approval"
        : "planned";
    const blockedReason = work.acceptanceMet
      ? null
      : escalate
        ? "escalation_owner_max_retries"
        : role.agentId === "tester"
          ? "tester_failed_or_incomplete"
          : "acceptance_not_met";

    // Model önerisi ≠ gerçek araç eylemi — ayrı kaydet
    const modelProposal = {
      summary: work.summary,
      analysis: work.analysis,
      recommendations: work.recommendations,
      risks: work.risks,
      proposedPatches: work.proposedPatches,
      draftKind: work.draftKind,
      findingKind: work.findingKind,
      modelAcceptanceMet: completion.parsedWork?.acceptanceMet ?? null,
    };
    const toolActions = evidence.map((e) => ({
      kind: e.kind,
      path: e.path ?? null,
      command: e.command ?? null,
      exitCode: e.exitCode ?? null,
      stdoutDigest: e.stdoutDigest ?? null,
      summary: e.summary,
      trusted: e.trusted,
    }));

    const evidenceRecord = {
      toolActions,
      acceptanceVerification: verified,
      modelProposal,
      sandbox: sandboxSession
        ? {
            projectSlug: sandboxSession.projectSlug,
            headSha: sandboxSession.headSha,
            appliedPaths: sandboxSession.appliedPaths,
            diffDigest: sandboxSession.diffDigest,
          }
        : null,
      work: {
        summary: work.summary.slice(0, 1200),
        analysis: (work.analysis ?? "").slice(0, 4000),
        draftKind: work.draftKind,
        findingKind: work.findingKind,
        recommendations: work.recommendations.slice(0, 12),
        risks: work.risks.slice(0, 12),
        requiresOwnerApproval: work.requiresOwnerApproval,
      },
    };
    const evidenceJson = JSON.stringify(evidenceRecord);
    const evidenceSha256 = createHash("sha256").update(evidenceJson).digest("hex");
    const compactResult = {
      schema: "agent_execution_v2",
      modelId: completion.modelId,
      executedAt: new Date().toISOString(),
      taskId: task.id,
      agentId: role.agentId,
      executionKind,
      realAiExecution: realAi,
      acceptanceMet: work.acceptanceMet,
      codeChangeApplied: work.codeChangeApplied,
      durationMs,
      attempts: nextAttempts,
      maxRetries,
      escalated: escalate,
      headSha: toolBundle.headSha,
      evidenceSha256,
      truncated: evidenceJson.length > 200_000,
      reasons: verified.reasons,
      presentEvidenceKinds: verified.presentEvidenceKinds,
    };

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: nextStatus,
        finishedAt: work.acceptanceMet ? new Date() : null,
        dispatchState: work.acceptanceMet
          ? "not_applicable"
          : escalate
            ? "blocked"
            : "ready",
        workflowPhase: work.acceptanceMet
          ? "completed"
          : escalate
            ? "failed"
            : "ready",
        executionKind,
        model: completion.modelId,
        executionResult: JSON.stringify(compactResult),
        blockedReason,
        executionPolicy: escalate ? "OWNER-APPROVAL" : task.executionPolicy,
      },
    });

    if (escalate) {
      const ver = `attempts:${nextAttempts}`;
      await prisma.approval
        .create({
          data: {
            type: "cloud_agent_run",
            requestedBy: role.agentId,
            projectId: task.projectId,
            taskId: task.id,
            title: `Escalation: ${role.agentId} · ${task.title}`.slice(0, 200),
            description: [
              `Görev ${task.id} ${maxRetries} retry sonrası Owner escalation.`,
              `blockedReason=${blockedReason}`,
              `acceptance=${verified.reasons.join("; ")}`.slice(0, 1500),
            ].join("\n"),
            changeSummary: "Sınırlı retry aşıldı; otomatik done yok.",
            risk: "medium",
            subjectKind: "task_escalation",
            subjectRef: task.id,
            subjectVersion: ver,
            currentVersion: ver,
            status: "pending",
          },
        })
        .catch(() => undefined);
    }

    const isDepartmentHandoff = false;
    const primaryTo = role.agentId === "tester" ? "cto" : "ceo";
    await prisma.agentMessage.create({
      data: {
        id: randomUUID(),
        fromAgentId: role.agentId,
        toAgentId: primaryTo,
        taskId: task.id,
        parentTaskId: task.parentTaskId,
        kind: "evidence",
        summary: `Kanıt kaydı sha256=${evidenceSha256} kinds=${verified.presentEvidenceKinds.join(",")}`,
        evidenceRef: `sha256:${evidenceSha256}`,
        payloadJson: evidenceJson.slice(0, 200_000),
      },
    });
    const msg = await prisma.agentMessage.create({
      data: {
        id: randomUUID(),
        fromAgentId: role.agentId,
        toAgentId: primaryTo,
        taskId: task.id,
        parentTaskId: task.parentTaskId,
        kind: work.acceptanceMet ? "result" : "failure",
        summary: `${role.displayName} sonucu: ${work.summary}`.slice(0, 1000),
        evidenceRef: `sha256:${evidenceSha256}`,
        payloadJson: JSON.stringify({
          ...compactResult,
          isDepartmentHandoff,
          isSelfHandoff: false,
        }),
      },
    });

    const { closeParentIfChildrenSettled } = await import("../engines/parent-task-lifecycle.js");
    await closeParentIfChildrenSettled(task.parentTaskId);

    if (
      role.agentId === "cto" &&
      work.acceptanceMet &&
      work.findingKind === "verified_defect" &&
      task.parentTaskId
    ) {
      await spawnDeveloperFollowOn(task);
    }

    const { shouldNotifyOwner, notifyOwnerIfMaterial } = await import("../engines/owner-notify.js");
    if (
      shouldNotifyOwner({
        agentId: role.agentId,
        acceptanceMet: Boolean(work.acceptanceMet),
        requiresOwnerApproval: work.requiresOwnerApproval,
        summary: `${work.summary}\n${verified.reasons.join("; ")}`,
        findingKind: work.findingKind,
        codeChangeApplied: work.codeChangeApplied,
        blockedReason,
      })
    ) {
      await notifyOwnerIfMaterial({
        fromAgent: role.agentId,
        taskId: task.id,
        parentTaskId: task.parentTaskId,
        summary: `Owner kararı: ${role.agentId} · ${task.title}`.slice(0, 400),
        payload: compactResult,
      });
    }

    // Tester → CTO zaten primary; Developer sonucu CEO'ya (primary) ek olarak tester bilgilendirmesi yok
    if (role.agentId === "developer" && sandboxSession) {
      await prisma.agentMessage.create({
        data: {
          id: randomUUID(),
          fromAgentId: "developer",
          toAgentId: "tester",
          taskId: task.id,
          parentTaskId: task.parentTaskId,
          kind: "handoff",
          summary: `Sandbox hazır: diff=${sandboxSession.diffDigest} files=${sandboxSession.appliedPaths.join(",")}`,
          evidenceRef: `sandbox_diff:${sandboxSession.diffDigest}`,
          payloadJson: JSON.stringify({
            sandbox: sandboxSession,
            realAiExecution: realAi,
            codeChangeApplied: work.codeChangeApplied,
          }).slice(0, 4000),
        },
      });
    }

    await writeAudit({
      category: "autonomy",
      action: "ai.local_agent_execution",
      actorKind: "agent",
      actorAgent: role.agentId,
      targetType: "task",
      targetId: task.id,
      summary: realAi
        ? `Yerel LLM ajan çıktısı: ${role.agentId} → ${nextStatus}`
        : `Mock ajan çıktısı: ${role.agentId} (gerçek AI değil)`,
      metadata: buildQuotaAuditMeta({
        quotaCallId,
        quotaKind: "agent",
        realAiExecution: realAi,
        providerInvoked: true,
        mode,
        extra: {
          modelId: completion.modelId,
          durationMs,
          acceptanceMet: work.acceptanceMet,
          codeChangeApplied: work.codeChangeApplied,
          executionKind,
          channel,
          isDepartmentHandoff,
          cloudStarted: false,
          sandboxMode,
          headSha: toolBundle.headSha,
          findingCategory: verified.findingCategory,
        },
      }),
    });

    const { setCeoEventPending } = await import("../engines/deferred-llm-queue.js");
    await setCeoEventPending(true);

    return {
      taskId,
      assigneeId: role.agentId,
      channel,
      realAiExecution: realAi,
      status: nextStatus,
      acceptanceMet: work.acceptanceMet,
      codeChangeApplied: work.codeChangeApplied,
      isDepartmentHandoff,
      modelId: completion.modelId,
      durationMs,
      messageId: msg.id,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message.slice(0, 400) : "agent_exec_error";
    const providerHit = providerInvoked;
    if (providerHit || (mode === "local" && /yerel llm|ollama|mock başarı/i.test(msg))) {
      await writeAudit({
        category: "autonomy",
        action: "ai.local_agent_execution",
        actorKind: "agent",
        actorAgent: role.agentId,
        targetType: "task",
        targetId: task.id,
        summary: `Ajan LLM çağrısı başarısız (kota: sağlayıcıya gidildiyse sayılır): ${msg}`.slice(0, 1000),
        metadata: buildQuotaAuditMeta({
          quotaCallId: quotaCallId ?? randomUUID(),
          quotaKind: "agent",
          realAiExecution: mode === "local",
          providerInvoked: true,
          mode,
          extra: { failed: true, error: msg },
        }),
      }).catch(() => undefined);
    }
    await prisma.task
      .update({
        where: { id: taskId },
        data: {
          status: "planned",
          dispatchState: "ready",
          workflowPhase: "failed",
          blockedReason: msg,
        },
      })
      .catch(() => undefined);
    // Kill switch / entegrasyon yok → fail-closed throw; şema vs. soft-fail
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode)
        : undefined;
    if (statusCode === 503 || statusCode === 423 || /kill switch/i.test(msg)) {
      throw error;
    }
    return {
      taskId,
      assigneeId: role?.agentId ?? task?.assigneeId ?? "-",
      channel: "blocked",
      realAiExecution: false,
      status: "planned",
      skippedReason: msg,
      acceptanceMet: false,
      codeChangeApplied: false,
      isDepartmentHandoff: false,
      modelId: null,
      durationMs: null,
      messageId: null,
    };
  } finally {
    await releaseLocalLlmCallLease();
    await releaseTaskExecutionLease(taskId);
  }
}

async function spawnDeveloperFollowOn(task: {
  id: string;
  parentTaskId: string | null;
  projectId: string;
  title: string;
  origin: string | null;
}): Promise<void> {
  if (!task.parentTaskId) return;
  const prisma = getPrisma();
  const existing = await prisma.task.findFirst({
    where: {
      archivedAt: null,
      OR: [
        { idempotencyKey: `followon-dev:${task.id}` },
        { parentTaskId: task.parentTaskId, assigneeId: "developer", status: { in: ["planned", "in_progress"] } },
      ],
    },
  });
  if (existing) return;
  const childId = randomUUID();
  await prisma.task.create({
    data: {
      id: childId,
      source: "real",
      title: `Uygula: ${task.title}`.slice(0, 140),
      description: `CTO verified_defect sonrası sandbox geliştirme. Kaynak görev=${task.id}`,
      projectId: task.projectId,
      assigneeId: "developer",
      priority: "high",
      status: "planned",
      dispatchState: "ready",
      executionPolicy: "AUTO",
      origin: task.origin,
      parentTaskId: task.parentTaskId,
      workflowPhase: "ready",
      executionKind: "real_ai_pending",
      acceptanceCriteria:
        "İzole sandbox_diff üretilmeli; ana repo değişmez; tester Docker exitCode=0 olmadan done olmaz.",
      idempotencyKey: `followon-dev:${task.id}`,
    },
  });
  await prisma.agentMessage.create({
    data: {
      fromAgentId: "cto",
      toAgentId: "developer",
      taskId: childId,
      parentTaskId: task.parentTaskId,
      kind: "handoff",
      summary: `CTO geliştirme görevi açtı: ${task.title}`.slice(0, 400),
      evidenceRef: `task:${task.id}`,
    },
  });
}

/** Dashboard / status için ajan kanal özeti */
export async function getLocalAgentExecutionStatus() {
  const env = getEnv();
  const prisma = getPrisma();
  const pending = await prisma.task.count({
    where: {
      source: "real",
      archivedAt: null,
      parentTaskId: { not: null },
      assigneeId: { not: "ceo" },
      status: { in: ["planned", "in_progress"] },
      OR: [{ executionKind: "real_ai_pending" }, { origin: { startsWith: "scheduler-ai-ceo:" } }],
    },
  });
  const doneLocal = await prisma.task.count({
    where: {
      source: "real",
      archivedAt: null,
      executionKind: "local_llm",
      status: "done",
    },
  });
  const doneMock = await prisma.task.count({
    where: {
      source: "real",
      archivedAt: null,
      executionKind: "mock_llm",
      status: "done",
    },
  });
  const repoModes = getRepositoryToolAdapter().getModes();
  const { getSchedulerRuntimeStatus } = await import("../engines/autonomy-scheduler.js");
  const { describeAutomationRuntime } = await import("../engines/automation-runtime.js");
  const kill = await getKillSwitch();
  const runtime = getSchedulerRuntimeStatus();
  const { enforceAutonomyWindow } = await import("../engines/autonomy-window.js");
  const { readOwnerGrants } = await import("../engines/owner-grants.js");
  const [windowGate, grants] = await Promise.all([enforceAutonomyWindow(), readOwnerGrants()]);
  const automation = describeAutomationRuntime({
    env,
    killEnabled: kill.enabled,
    timerActive: runtime.timerActive,
    lastTickTrigger: runtime.lastTickTrigger,
    windowActive: windowGate.active,
    permanentLocalAutonomy: grants.permanentLocalAutonomy,
  });
  return {
    mode: env.LOCAL_AGENT_EXECUTION_MODE,
    maxPerDay: env.LOCAL_AGENT_EXECUTION_MAX_PER_DAY,
    pendingReady: pending,
    completedLocalLlm: doneLocal,
    completedMockLlm: doneMock,
    continuousAutomation: automation.continuousAutomation,
    automationReason: automation.reason,
    triggerSource: automation.triggerSource,
    timerActive: automation.timerActive,
    cloudAutoDispatch: false,
    repoToolsMode: repoModes.tools,
    sandboxMode: repoModes.sandbox,
  };
}
