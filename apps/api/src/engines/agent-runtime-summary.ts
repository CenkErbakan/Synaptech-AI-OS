import {
  AGENT_CAPABILITY_MATRIX,
  AGENT_IDS,
  getAgentCapabilities,
  type AgentId,
} from "@synaptech/shared";

import { getEnv } from "../lib/env.js";
import { getPrisma } from "../db/prisma.js";
import { listProjectRepoBindings } from "../ai/repo/project-repo-registry.js";
import { describeAutomationRuntime } from "./automation-runtime.js";
import { getSchedulerRuntimeStatus } from "./autonomy-scheduler.js";
import { getKillSwitch } from "./kill-switch.js";
import { getQuotaSnapshot } from "../ai/llm-call-guard.js";

export type RuntimeChannel = "LOCAL_LLM" | "MOCK" | "CLOUD_LIVE" | "DETERMINISTIC" | "NONE";

export type AgentTaskSnapshot = {
  id: string;
  title: string;
  status: string;
  executionKind: string | null;
  model: string | null;
  origin: string | null;
  acceptanceMet: boolean | null;
  codeChangeApplied: boolean | null;
  repoReadCount: number;
  realAiExecution: boolean | null;
  durationMs: number | null;
  blockedReason: string | null;
  updatedAt: string;
};

export type AgentRuntimeCard = {
  agentId: AgentId;
  currentlyWorking: boolean;
  statusLabel: "working" | "idle" | "completed_recent" | "failed" | "no_records" | "disabled";
  channel: RuntimeChannel;
  lastRealModel: string | null;
  lastProvider: "local" | "mock" | "cloud" | "deterministic" | "none";
  taskCounts: {
    planned: number;
    in_progress: number;
    done: number;
    failed: number;
    total: number;
  };
  /** Kuyruk: planned/backlog + ready */
  queue: Array<{ id: string; title: string; status: string; priority?: string }>;
  /** Blokajlar */
  blocks: Array<{ id: string; title: string; blockedReason: string | null; status: string }>;
  lastDurationMs: number | null;
  capabilities: string[];
  lastActivityAt: string | null;
  /** Kartta gösterilen birincil görev: gerçek LLM varsa o; yoksa en güncel. */
  lastTask: AgentTaskSnapshot | null;
  /** En güncel herhangi bir görev (mock/test dahil). */
  mostRecentTask: AgentTaskSnapshot | null;
  lastMessage: {
    id: string;
    kind: string;
    summary: string;
    from: string;
    to: string;
    at: string;
  } | null;
  notes: string[];
};

function mapChannel(executionKind: string | null | undefined, realAi?: boolean | null): RuntimeChannel {
  if (!executionKind) return "NONE";
  const k = executionKind.toLowerCase();
  if (k.includes("local_llm") || (realAi === true && k.includes("llm"))) return "LOCAL_LLM";
  if (k.includes("mock")) return "MOCK";
  if (k.includes("cloud")) return "CLOUD_LIVE";
  if (k.includes("deterministic") || k === "none") return "DETERMINISTIC";
  if (k.includes("real_ai")) return "LOCAL_LLM";
  return "NONE";
}

function parseExecutionMeta(executionResult: string | null | undefined): {
  acceptanceMet: boolean | null;
  codeChangeApplied: boolean | null;
  repoReadCount: number;
  realAiExecution: boolean | null;
  modelId: string | null;
  durationMs: number | null;
} {
  if (!executionResult) {
    return {
      acceptanceMet: null,
      codeChangeApplied: null,
      repoReadCount: 0,
      realAiExecution: null,
      modelId: null,
      durationMs: null,
    };
  }
  try {
    const parsed = JSON.parse(executionResult) as {
      acceptanceMet?: boolean;
      codeChangeApplied?: boolean;
      realAiExecution?: boolean;
      modelId?: string;
      durationMs?: number;
      toolEvidence?: Array<{ kind?: string }>;
      evidenceUsed?: string[];
      work?: { acceptanceMet?: boolean; codeChangeApplied?: boolean };
    };
    const fromTools = Array.isArray(parsed.toolEvidence)
      ? parsed.toolEvidence.filter((e) => e.kind === "repo_read").length
      : 0;
    const fromEvidenceUsed = Array.isArray(parsed.evidenceUsed)
      ? parsed.evidenceUsed.filter((e) => typeof e === "string" && e.startsWith("repo_read:")).length
      : 0;
    return {
      acceptanceMet: parsed.acceptanceMet ?? parsed.work?.acceptanceMet ?? null,
      codeChangeApplied: parsed.codeChangeApplied ?? parsed.work?.codeChangeApplied ?? null,
      repoReadCount: Math.max(fromTools, fromEvidenceUsed),
      realAiExecution: parsed.realAiExecution ?? null,
      modelId: parsed.modelId ?? null,
      durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : null,
    };
  } catch {
    return {
      acceptanceMet: null,
      codeChangeApplied: null,
      repoReadCount: 0,
      realAiExecution: null,
      modelId: null,
      durationMs: null,
    };
  }
}

function toTaskSnapshot(
  row: {
    id: string;
    title: string;
    status: string;
    executionKind: string | null;
    model: string | null;
    origin: string | null;
    executionResult: string | null;
    blockedReason?: string | null;
    updatedAt: Date;
  } | null,
): AgentTaskSnapshot | null {
  if (!row) return null;
  const meta = parseExecutionMeta(row.executionResult);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    executionKind: row.executionKind,
    model: row.model ?? meta.modelId,
    origin: row.origin,
    acceptanceMet: meta.acceptanceMet,
    codeChangeApplied: meta.codeChangeApplied,
    repoReadCount: meta.repoReadCount,
    realAiExecution: meta.realAiExecution,
    durationMs: meta.durationMs,
    blockedReason: row.blockedReason ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Gerçek LLM / pilot görevlerini mock ve deterministic kayıtlardan öne al. */
function pickPrimaryTask<
  T extends {
    title: string;
    origin: string | null;
    executionKind: string | null;
    executionResult: string | null;
    status: string;
    updatedAt: Date;
  },
>(mine: T[], agentId: AgentId): T | null {
  if (!mine.length) return null;
  let best = mine[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const t of mine) {
    const meta = parseExecutionMeta(t.executionResult);
    const channel = mapChannel(t.executionKind, meta.realAiExecution);
    let score = t.updatedAt.getTime();
    if (meta.realAiExecution === true || channel === "LOCAL_LLM") score += 1e15;
    // CTO Subify salt-okunur pilot (T-P5E-005) — repo_read kanıtı kritik
    if (agentId === "cto" && (t.title.includes("T-P5E-005") || t.origin?.includes("T-P5E-005"))) {
      score += 5e14;
    }
    if (meta.repoReadCount > 0) score += 2e14 + meta.repoReadCount * 1e12;
    if (t.status === "done" && (meta.realAiExecution || channel === "LOCAL_LLM")) score += 1e14;
    // CEO planlama pilotu
    if (agentId === "ceo" && (t.origin?.includes("T-P5E-003") || t.title.includes("T-P5E-003"))) {
      score += 4e14;
    }
    if (t.origin?.includes("T-P5E") || t.title.includes("T-P5E")) score += 5e13;
    if (channel === "MOCK") score -= 1e11;
    if (channel === "DETERMINISTIC") score -= 5e10;
    if (t.origin?.includes("test-agent") || t.title.toLowerCase().startsWith("test parent")) {
      score -= 2e11;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function isLiveExecutionActive(env: ReturnType<typeof getEnv>): boolean {
  return (
    env.LOCAL_AGENT_EXECUTION_MODE !== "off" ||
    env.SCHEDULER_AI_CEO_MODE !== "off" ||
    (env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE === "live")
  );
}

export async function buildAgentRuntimeSummary() {
  const env = getEnv();
  const prisma = getPrisma();
  const now = new Date();
  const schedulerRuntime = getSchedulerRuntimeStatus();
  const [killSwitch, quotaSnap, windowGate, grants] = await Promise.all([
    getKillSwitch(),
    getQuotaSnapshot(now),
    import("./autonomy-window.js").then((m) => m.enforceAutonomyWindow(now)),
    import("./owner-grants.js").then((m) => m.readOwnerGrants()),
  ]);
  const automation = describeAutomationRuntime({
    env,
    killEnabled: killSwitch.enabled,
    timerActive: schedulerRuntime.timerActive,
    lastTickTrigger: schedulerRuntime.lastTickTrigger,
    windowActive: windowGate.active,
    permanentLocalAutonomy: grants.permanentLocalAutonomy,
  });

  const [agents, tasks, messages, projects, bindings, cloudRuns, schedulerAudits, agentAudits] =
    await Promise.all([
      prisma.agent.findMany({ orderBy: { id: "asc" } }),
      prisma.task.findMany({
        where: { source: "real", archivedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 2000,
        select: {
          id: true,
          title: true,
          status: true,
          assigneeId: true,
          executionKind: true,
          model: true,
          origin: true,
          executionResult: true,
          blockedReason: true,
          dispatchState: true,
          priority: true,
          updatedAt: true,
          finishedAt: true,
          createdAt: true,
        },
      }),
      prisma.agentMessage.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          kind: true,
          summary: true,
          fromAgentId: true,
          toAgentId: true,
          createdAt: true,
          taskId: true,
        },
      }),
      prisma.project.findMany({
        select: {
          slug: true,
          name: true,
          githubRepoUrl: true,
          cloudAgentEnabled: true,
          status: true,
        },
      }),
      listProjectRepoBindings(),
      prisma.agentRun.findMany({
        where: {
          OR: [
            { executionMode: { in: ["live", "mock"] } },
            { cursorAgentId: { not: null } },
            { cursorRunId: { not: null } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          executionMode: true,
          createdAt: true,
          finishedAt: true,
          cursorAgentId: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { action: { in: ["ai.scheduler_ceo_cycle", "ai.local_ceo_pilot"] } },
        orderBy: { at: "desc" },
        take: 50,
        select: { action: true, at: true, summary: true, metadata: true },
      }),
      prisma.auditLog.findMany({
        where: { action: "ai.local_agent_execution" },
        orderBy: { at: "desc" },
        take: 50,
        select: { at: true, summary: true, metadata: true, actorAgent: true },
      }),
    ]);

  const liveActive = isLiveExecutionActive(env);

  const preferredCeoAudit =
    schedulerAudits.find(
      (a) =>
        a.action === "ai.local_ceo_pilot" ||
        (typeof a.summary === "string" &&
          (a.summary.includes("T-P5E-003") || a.summary.toLowerCase().includes("yerel"))),
    ) ??
    schedulerAudits.find(
      (a) =>
        typeof a.metadata === "string" &&
        (a.metadata.includes("T-P5E-003") || a.metadata.includes('"mode":"local"')),
    ) ??
    schedulerAudits[0] ??
    null;

  const agentCards: AgentRuntimeCard[] = AGENT_IDS.map((agentId) => {
    const row = agents.find((a) => a.id === agentId);
    const mine = tasks.filter((t) => t.assigneeId === agentId);
    const counts = {
      planned: mine.filter((t) => t.status === "planned" || t.status === "backlog").length,
      in_progress: mine.filter((t) => t.status === "in_progress").length,
      done: mine.filter((t) => t.status === "done").length,
      failed: mine.filter((t) => t.status === "failed").length,
      total: mine.length,
    };

    const mostRecentRow = mine[0] ?? null;
    // Tester: deterministic/fixture canlı AI gibi gösterilmez.
    const primaryPool =
      agentId === "tester"
        ? mine.filter((t) => {
            const m = parseExecutionMeta(t.executionResult);
            return mapChannel(t.executionKind, m.realAiExecution) === "LOCAL_LLM";
          })
        : mine;
    const primaryRow = pickPrimaryTask(primaryPool, agentId);
    const primarySnap = toTaskSnapshot(primaryRow);
    const mostRecentSnap = toTaskSnapshot(mostRecentRow);
    const meta = parseExecutionMeta(primaryRow?.executionResult);

    const primaryTaskId = primaryRow?.id;
    const lastMsg =
      (primaryTaskId
        ? messages.find(
            (m) =>
              m.taskId === primaryTaskId &&
              (m.fromAgentId === agentId || m.toAgentId === agentId),
          )
        : null) ??
      messages.find((m) => m.fromAgentId === agentId || m.toAgentId === agentId) ??
      null;

    const relatedAudit = agentAudits.find((a) => a.actorAgent === agentId);
    let lastActivityAt: string | null = null;
    const candidates = [
      mostRecentRow?.updatedAt?.toISOString(),
      primaryRow?.updatedAt?.toISOString(),
      lastMsg?.createdAt?.toISOString(),
      relatedAudit?.at?.toISOString(),
    ].filter(Boolean) as string[];
    if (agentId === "ceo" && preferredCeoAudit) {
      candidates.push(preferredCeoAudit.at.toISOString());
    }
    if (candidates.length) {
      lastActivityAt = candidates.sort((a, b) => b.localeCompare(a))[0] ?? null;
    }

    const channel = mapChannel(primaryRow?.executionKind, meta.realAiExecution);
    const lastRealModel =
      (channel === "LOCAL_LLM"
        ? meta.modelId || primaryRow?.model || env.LOCAL_LLM_MODEL
        : meta.modelId || primaryRow?.model) ?? null;

    // Modlar kapalıysa "çalışıyor" gösterme (stale in_progress test artıkları).
    const currentlyWorking = liveActive && counts.in_progress > 0;

    const notes: string[] = [];
    if (
      agentId === "developer" &&
      meta.codeChangeApplied === false &&
      channel === "LOCAL_LLM"
    ) {
      notes.push("Gerçek LLM analizi var; kod değişikliği uygulanmadı (codeChangeApplied=false).");
    }
    if (agentId === "cto" && meta.repoReadCount > 0) {
      notes.push(`${meta.repoReadCount} repo_read kanıtı birincil görevde.`);
    }
    if (agentId === "tester") {
      const hasLiveLlm = mine.some((t) => {
        const m = parseExecutionMeta(t.executionResult);
        return mapChannel(t.executionKind, m.realAiExecution) === "LOCAL_LLM";
      });
      if (!hasLiveLlm) {
        notes.push("Canlı gerçek Tester AI yürütmesi yok (deterministic/fixture karıştırılmaz).");
      }
    }
    if (agentId === "ceo" && preferredCeoAudit) {
      notes.push(`Son CEO AI audit: ${preferredCeoAudit.action}`);
      if (preferredCeoAudit.summary) notes.push(preferredCeoAudit.summary.slice(0, 180));
    }
    if (
      mostRecentSnap &&
      primarySnap &&
      mostRecentSnap.id !== primarySnap.id &&
      mapChannel(mostRecentRow?.executionKind, parseExecutionMeta(mostRecentRow?.executionResult).realAiExecution) ===
        "MOCK"
    ) {
      notes.push("En güncel kayıt mock/test; kartta gerçek LLM/pilot görev öncelikli gösterildi.");
    }

    let statusLabel: AgentRuntimeCard["statusLabel"] = "no_records";
    if (row && !row.enabled) statusLabel = "disabled";
    else if (currentlyWorking) statusLabel = "working";
    else if (
      counts.total === 0 &&
      !lastMsg &&
      !(agentId === "ceo" && preferredCeoAudit)
    ) {
      statusLabel = "no_records";
    } else if (primaryRow?.status === "failed") statusLabel = "failed";
    else if (primaryRow?.status === "done" && channel === "LOCAL_LLM") {
      const finished = (primaryRow.finishedAt ?? primaryRow.updatedAt).getTime();
      statusLabel =
        now.getTime() - finished <= 7 * 24 * 60 * 60 * 1000 ? "completed_recent" : "idle";
    } else if (agentId === "tester" && channel !== "LOCAL_LLM" && channel !== "CLOUD_LIVE") {
      statusLabel = counts.total === 0 ? "no_records" : "idle";
    } else statusLabel = "idle";

    const lastProvider =
      channel === "LOCAL_LLM"
        ? "local"
        : channel === "MOCK"
          ? "mock"
          : channel === "CLOUD_LIVE"
            ? "cloud"
            : channel === "DETERMINISTIC"
              ? "deterministic"
              : "none";

    const queue = mine
      .filter(
        (t) =>
          (t.status === "planned" || t.status === "backlog") &&
          (t.dispatchState === "ready" ||
            t.dispatchState === "not_applicable" ||
            !t.dispatchState),
      )
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
      }));
    const blocks = mine
      .filter(
        (t) =>
          Boolean(t.blockedReason) ||
          t.dispatchState === "blocked" ||
          t.status === "awaiting_approval",
      )
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        title: t.title,
        blockedReason: t.blockedReason,
        status: t.status,
      }));
    const caps = getAgentCapabilities(agentId).capabilities;

    return {
      agentId,
      currentlyWorking,
      statusLabel,
      channel,
      lastRealModel,
      lastProvider,
      taskCounts: counts,
      queue,
      blocks,
      lastDurationMs: meta.durationMs ?? primarySnap?.durationMs ?? null,
      capabilities: [...caps],
      lastActivityAt,
      lastTask: primarySnap,
      mostRecentTask: mostRecentSnap,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            kind: lastMsg.kind,
            summary: lastMsg.summary,
            from: lastMsg.fromAgentId,
            to: lastMsg.toAgentId,
            at: lastMsg.createdAt.toISOString(),
          }
        : null,
      notes,
    };
  });

  const pastCloudPilot = cloudRuns.length > 0;
  const cloudLiveNow = env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE === "live";

  const realLocalCeoCount = schedulerAudits.filter(
    (a) =>
      a.action === "ai.local_ceo_pilot" ||
      (typeof a.metadata === "string" && a.metadata.includes('"mode":"local"')),
  ).length;

  return {
    source: "api" as const,
    generatedAt: now.toISOString(),
    continuousAutomation: automation.continuousAutomation,
    automation,
    schedulerRuntime,
    quota: quotaSnap,
    autonomyWindow: windowGate,
    capabilityMatrix: AGENT_CAPABILITY_MATRIX.map((r) => ({
      agentId: r.agentId,
      capabilities: [...r.capabilities],
      autoAllowedInControlledMode: r.autoAllowedInControlledMode,
      requiresOwnerApprovalActions: [...r.requiresOwnerApprovalActions],
    })),
    modes: {
      schedulerAiCeoMode: env.SCHEDULER_AI_CEO_MODE,
      localAgentExecutionMode: env.LOCAL_AGENT_EXECUTION_MODE,
      controlledAutonomyMode: env.CONTROLLED_AUTONOMY_MODE,
      agentRepoToolsMode: env.AGENT_REPO_TOOLS_MODE,
      agentSandboxMode: env.AGENT_SANDBOX_MODE,
      modelProvider: env.MODEL_PROVIDER,
      localLlmModel: env.LOCAL_LLM_MODEL,
      cloudLiveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
      cursorCloudMode: env.CURSOR_CLOUD_MODE,
      onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
      localAgentTickMax: env.LOCAL_AGENT_TICK_MAX,
      perAgentDailyMax: env.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY,
      maxRetries: env.CONTROLLED_AUTONOMY_MAX_RETRIES,
    },
    configDeclaredStatus: {
      source: "config/system-status.yaml" as const,
      cursor: "none" as const,
      github: "not_connected" as const,
    },
    cursor: {
      definedRole: "coding_agent_only",
      /** IDE açık olması Cloud API kanıtı değildir. */
      ideIsNotProof: true,
      credentialConfigured: Boolean(env.CURSOR_API_KEY && env.CURSOR_API_KEY.length >= 8),
      pastPilotExists: pastCloudPilot,
      liveEnabled: cloudLiveNow,
      liveLabel: cloudLiveNow
        ? "Cloud live açık"
        : pastCloudPilot
          ? "Geçmiş Cloud pilot var · şu an live kapalı"
          : "Cloud live kapalı · pilot yok",
      detailEndpoint: "/api/integrations/status",
    },
    github: {
      /** App kurulumu bu özetten doğrulanmaz — UNKNOWN. */
      appConnection: "unknown" as const,
      appLabel: "GitHub App: UNKNOWN (doğrulanmadı) · API token App sayılmaz",
      projects: projects.map((p) => {
        const binding = bindings.find((b) => b.projectSlug === p.slug);
        const verified = Boolean(p.githubRepoUrl) && (binding?.verified ?? Boolean(p.githubRepoUrl));
        return {
          slug: p.slug,
          name: p.name,
          githubRepoUrl: verified ? p.githubRepoUrl : null,
          verified,
          cloudAgentEnabled: p.cloudAgentEnabled,
          bindingSource: binding?.source ?? "none",
          label: verified
            ? `Verified repo: ${p.githubRepoUrl}`
            : "Proje repo bağı: doğrulanmadı",
        };
      }),
      cloudAgentPermission: cloudLiveNow
        ? "Cloud Agent çalıştırma: açık (ayrı onay/bütçe hâlâ gerekir)"
        : "Cloud Agent çalıştırma: kapalı",
      detailEndpoint: "/api/integrations/status",
    },
    ceoScheduler: {
      mode: env.SCHEDULER_AI_CEO_MODE,
      lastAuditAt: preferredCeoAudit?.at?.toISOString() ?? null,
      lastSummary: preferredCeoAudit?.summary ?? null,
      lastAction: preferredCeoAudit?.action ?? null,
      recentCount: schedulerAudits.length,
      realLocalCount: realLocalCeoCount,
    },
    agents: agentCards,
  };
}

export type AgentRuntimeSummary = Awaited<ReturnType<typeof buildAgentRuntimeSummary>>;
