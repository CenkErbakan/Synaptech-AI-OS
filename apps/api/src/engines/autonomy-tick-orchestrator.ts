import { listAutoAllowedAgents } from "./autonomy-policy-gate.js";
import { getEnv } from "../lib/env.js";
import { getKillSwitch } from "./kill-switch.js";
import { writeAudit } from "./audit.js";
import { describeAutomationRuntime } from "./automation-runtime.js";

export type ControlledAutonomyTickResult = {
  mode: string;
  continuousAutomation: boolean;
  skipped: boolean;
  reason?: string;
  ceoCycle?: unknown;
  agentPass?: {
    mode: string;
    processed: unknown[];
    cloudStarted: false;
  };
  ollamaUnavailableNote?: string;
};

/**
 * CEO değerlendirmesi sonrası yerel ajan geçişi.
 * CONTROLLED_AUTONOMY_MODE=off iken hiçbir LLM/ajan pass çalıştırmaz (entegrasyon hazırlığı).
 * continuousAutomation her zaman false — Owner onayı olmadan sürekli otonomi yok.
 */
export async function runControlledAutonomyTick(input?: {
  ceoCycleResult?: unknown;
  skipCeo?: boolean;
}): Promise<ControlledAutonomyTickResult> {
  const env = getEnv();
  const mode = env.CONTROLLED_AUTONOMY_MODE;
  const kill = await getKillSwitch();
  const { getSchedulerRuntimeStatus } = await import("./autonomy-scheduler.js");
  const { readOwnerGrants } = await import("./owner-grants.js");
  const { enforceAutonomyWindow } = await import("./autonomy-window.js");
  const runtime = getSchedulerRuntimeStatus();
  const [grants, windowGate] = await Promise.all([readOwnerGrants(), enforceAutonomyWindow()]);
  const automation = describeAutomationRuntime({
    env,
    killEnabled: kill.enabled,
    timerActive: runtime.timerActive,
    lastTickTrigger: runtime.lastTickTrigger ?? "none",
    windowActive: windowGate.active,
    permanentLocalAutonomy: grants.permanentLocalAutonomy,
  });
  const base: ControlledAutonomyTickResult = {
    mode,
    continuousAutomation: automation.continuousAutomation,
    skipped: true,
  };

  if (kill.enabled) {
    return { ...base, reason: "kill_switch" };
  }

  if (mode === "off") {
    return {
      ...base,
      reason: "controlled_autonomy_mode_off",
      ceoCycle: input?.ceoCycleResult,
    };
  }

  if (mode === "local") {
    if (!windowGate.active && !grants.permanentLocalAutonomy) {
      return { ...base, reason: windowGate.reason, ceoCycle: input?.ceoCycleResult };
    }
  }

  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    return { ...base, reason: "cloud_live_blocked" };
  }

  // mode mock|local — ajan pass yalnızca LOCAL_AGENT_EXECUTION_MODE ile hizalıysa
  const agentMode = env.LOCAL_AGENT_EXECUTION_MODE;
  if (agentMode === "off") {
    await writeAudit({
      category: "autonomy",
      action: "autonomy.controlled_tick",
      actorKind: "system",
      summary: "Kontrollü tick: ajan yürütme kapalı (LOCAL_AGENT_EXECUTION_MODE=off)",
      metadata: {
        controlledMode: mode,
        continuousAutomation: false,
        realAiExecution: false,
      },
    });
    return {
      ...base,
      skipped: true,
      reason: "local_agent_execution_mode_off",
      ceoCycle: input?.ceoCycleResult,
    };
  }

  if (mode === "local" && agentMode !== "local") {
    return {
      ...base,
      reason: "controlled_local_requires_local_agent_mode",
      ceoCycle: input?.ceoCycleResult,
    };
  }

  if (mode === "mock" && agentMode !== "mock") {
    return {
      ...base,
      reason: "controlled_mock_requires_mock_agent_mode",
      ceoCycle: input?.ceoCycleResult,
    };
  }

  const { runLocalAgentExecutionPass } = await import("../ai/local-agent-execution.js");
  const allowed = listAutoAllowedAgents().filter((id) => id !== "ceo");
  const limit = Math.min(env.LOCAL_AGENT_TICK_MAX, 4);

  let agentPass: ControlledAutonomyTickResult["agentPass"];
  try {
    const pass = await runLocalAgentExecutionPass({
      limit,
      agentIds: allowed,
    });
    agentPass = pass;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "agent_pass_error";
    const ollamaDown = /ollama|yerel llm|local.?llm|ECONNREFUSED|unreachable/i.test(msg);
    await writeAudit({
      category: "autonomy",
      action: "autonomy.controlled_tick",
      actorKind: "system",
      summary: `Kontrollü tick ajan pass hatası: ${msg.slice(0, 200)}`,
      metadata: {
        controlledMode: mode,
        continuousAutomation: false,
        realAiExecution: false,
        ollamaUnavailable: ollamaDown,
        cloudFallback: false,
      },
    });
    return {
      mode,
      continuousAutomation: automation.continuousAutomation,
      skipped: false,
      reason: msg.slice(0, 300),
      ceoCycle: input?.ceoCycleResult,
      ollamaUnavailableNote: ollamaDown
        ? "PC kapalıyken veya Ollama çalışmıyorken yerel model kullanılamaz; Cloud/ücretli API'ye geçilmez."
        : undefined,
    };
  }

  const processed = (agentPass?.processed ?? []) as Array<{
    assigneeId?: string;
    taskId?: string;
    status?: string;
    acceptanceMet?: boolean;
  }>;
  if (processed.length) {
    const { getPrisma } = await import("../db/prisma.js");
    const { randomUUID } = await import("node:crypto");
    await getPrisma().agentMessage.create({
      data: {
        id: randomUUID(),
        fromAgentId: "ceo",
        toAgentId: "ceo",
        kind: "result",
        summary: `Ajan pass özeti (${processed.length}): ${processed
          .map((p) => `${p.assigneeId}:${p.status}:acc=${String(p.acceptanceMet)}`)
          .join("; ")}`.slice(0, 1000),
        evidenceRef: "autonomy.controlled_tick",
        payloadJson: JSON.stringify({
          processed,
          realAiExecution: mode === "local",
          cloudStarted: false,
        }).slice(0, 4000),
      },
    }).catch(() => undefined);
  }

  const { closeSettledCeoParents } = await import("./parent-task-lifecycle.js");
  await closeSettledCeoParents().catch(() => 0);

  await writeAudit({
    category: "autonomy",
    action: "autonomy.controlled_tick",
    actorKind: "system",
    summary: `Kontrollü otonomi tick: agentPass processed=${agentPass?.processed.length ?? 0}`,
    metadata: {
      controlledMode: mode,
      continuousAutomation: automation.continuousAutomation,
      realAiExecution: mode === "local",
      tickMax: limit,
      cloudStarted: false,
    },
  });

  return {
    mode,
    continuousAutomation: automation.continuousAutomation,
    skipped: false,
    ceoCycle: input?.ceoCycleResult,
    agentPass,
  };
}
