import type { Env } from "../lib/env.js";

export type TickTrigger = "timer" | "manual_api" | "none";

export type AutomationRuntime = {
  /** Timer + üç kapı açık + kill/cloud kapalı. Sabit false değildir. */
  continuousAutomation: boolean;
  reason: string;
  triggerSource: TickTrigger;
  timerActive: boolean;
  modesArmed: boolean;
  schedulerAiCeoMode: string;
  localAgentExecutionMode: string;
  controlledAutonomyMode: string;
  killEnabled: boolean;
  cloudLiveBlocked: boolean;
  note: string;
};

export function describeAutomationRuntime(input: {
  env: Env;
  killEnabled: boolean;
  timerActive: boolean;
  lastTickTrigger?: TickTrigger | null;
  windowActive?: boolean;
  /** T-P5E-009 24s pencereden bağımsız kalıcı yerel otonomi. */
  permanentLocalAutonomy?: boolean;
}): AutomationRuntime {
  const cloudLiveBlocked =
    input.env.CLOUD_AGENT_LIVE_ENABLED || input.env.CURSOR_CLOUD_MODE === "live";
  const windowOk = input.windowActive !== false || input.permanentLocalAutonomy === true;
  const modesArmed =
    windowOk &&
    input.env.SCHEDULER_AI_CEO_MODE !== "off" &&
    input.env.LOCAL_AGENT_EXECUTION_MODE !== "off" &&
    input.env.CONTROLLED_AUTONOMY_MODE !== "off" &&
    input.env.SCHEDULER_AI_CEO_MODE === input.env.LOCAL_AGENT_EXECUTION_MODE &&
    input.env.CONTROLLED_AUTONOMY_MODE === input.env.LOCAL_AGENT_EXECUTION_MODE;

  let reason = "ok";
  if (input.killEnabled) reason = "kill_switch";
  else if (cloudLiveBlocked) reason = "cloud_live_blocked";
  else if (input.windowActive === false && !input.permanentLocalAutonomy) {
    reason = "no_or_expired_autonomy_window";
  }
  else if (input.env.CONTROLLED_AUTONOMY_MODE === "off") reason = "controlled_autonomy_mode_off";
  else if (input.env.SCHEDULER_AI_CEO_MODE === "off") reason = "scheduler_ai_ceo_mode_off";
  else if (input.env.LOCAL_AGENT_EXECUTION_MODE === "off") reason = "local_agent_execution_mode_off";
  else if (!modesArmed) reason = "mode_mismatch";
  else if (!input.timerActive) reason = "timer_inactive_manual_api_only";

  const continuousAutomation =
    !input.killEnabled && !cloudLiveBlocked && modesArmed && input.timerActive;

  const triggerSource: TickTrigger = input.timerActive
    ? "timer"
    : input.lastTickTrigger === "manual_api"
      ? "manual_api"
      : "none";

  return {
    continuousAutomation,
    reason,
    triggerSource,
    timerActive: input.timerActive,
    modesArmed,
    schedulerAiCeoMode: input.env.SCHEDULER_AI_CEO_MODE,
    localAgentExecutionMode: input.env.LOCAL_AGENT_EXECUTION_MODE,
    controlledAutonomyMode: input.env.CONTROLLED_AUTONOMY_MODE,
    killEnabled: input.killEnabled,
    cloudLiveBlocked,
    note: continuousAutomation
      ? "Timer bu süreçte aktif; kontrollü otonomi kapıları açık."
      : "Sürekli otomasyon yok. Timer yoksa yalnızca Owner manuel tick.",
  };
}
