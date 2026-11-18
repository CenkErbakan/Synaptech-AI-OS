import { describe, expect, it } from "vitest";

import {
  budgetResult,
  countQuotaFromRows,
  nextUtcDayStart,
  parseQuotaEvent,
  uniqueBilled,
  utcDayBounds,
  type QuotaAuditRow,
} from "../src/ai/llm-quota.js";
import { describeAutomationRuntime } from "../src/engines/automation-runtime.js";

function row(
  id: string,
  action: string,
  metadata: Record<string, unknown>,
  actorAgent: string | null = "cto",
): QuotaAuditRow {
  return { id, action, actorAgent, metadata: JSON.stringify(metadata) };
}

describe("UTC gün sınırları", () => {
  it("gün 00:00 UTC başlar, sonraki gün reset", () => {
    const now = new Date("2026-11-18T23:30:00.000Z");
    const { start, end } = utcDayBounds(now);
    expect(start.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(nextUtcDayStart(now).toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });
});

describe("Kota parse / çift sayım", () => {
  it("mode=local gerçek AI sayılmaz", () => {
    const e = parseQuotaEvent(
      row("1", "ai.scheduler_ceo_cycle", { mode: "local", realAiExecution: false }),
    );
    expect(e.realBilled).toBe(false);
    expect(e.mockBilled).toBe(true);
    expect(e.kind).toBe("scheduler_ceo");
  });

  it("gerçek ajan vs CEO ayrılır; pilot hariç", () => {
    const rows: QuotaAuditRow[] = [
      row("a", "ai.scheduler_ceo_cycle", { realAiExecution: true, mode: "local" }, "ceo"),
      row("b", "ai.scheduler_ceo_cycle", { realAiExecution: false, mode: "mock" }, "ceo"),
      row("c", "ai.local_agent_execution", { realAiExecution: true, mode: "local" }, "developer"),
      row("d", "ai.local_agent_execution", { realAiExecution: true, mode: "local" }, "tester"),
      row("e", "ai.local_ceo_pilot", { realAiExecution: true, mode: "local" }, "ceo"),
    ];
    const c = countQuotaFromRows(rows);
    expect(c.ceoReal).toBe(1);
    expect(c.ceoMock).toBe(1);
    expect(c.agentReal).toBe(2);
    expect(c.perAgentReal.developer).toBe(1);
    expect(c.perAgentReal.tester).toBe(1);
  });

  it("aynı quotaCallId çift sayılmaz", () => {
    const events = [
      parseQuotaEvent(
        row("1", "ai.local_agent_execution", {
          realAiExecution: true,
          quotaCallId: "same",
        }),
      ),
      parseQuotaEvent(
        row("2", "ai.local_agent_execution", {
          realAiExecution: true,
          quotaCallId: "same",
        }),
      ),
    ];
    expect(uniqueBilled(events, (e) => e.realBilled)).toBe(1);
  });

  it("kota dolunca nextEligibleAt verir", () => {
    const now = new Date("2026-11-18T15:00:00.000Z");
    const r = budgetResult(1, 1, "daily_llm_cap_reached", now);
    expect(r.ok).toBe(false);
    expect(r.nextEligibleAt).toBe("2026-11-19T00:00:00.000Z");
  });
});

describe("describeAutomationRuntime", () => {
  const envOff = {
    SCHEDULER_AI_CEO_MODE: "off",
    LOCAL_AGENT_EXECUTION_MODE: "off",
    CONTROLLED_AUTONOMY_MODE: "off",
    CLOUD_AGENT_LIVE_ENABLED: false,
    CURSOR_CLOUD_MODE: "mock",
  } as unknown as import("../src/lib/env.js").Env;

  it("kapılar off iken continuousAutomation false (sabit değil, türetilmiş)", () => {
    const d = describeAutomationRuntime({
      env: envOff,
      killEnabled: false,
      timerActive: true,
    });
    expect(d.continuousAutomation).toBe(false);
    expect(d.reason).toBe("controlled_autonomy_mode_off");
  });

  it("timer yoksa kapılar açık olsa da otonom değil", () => {
    const env = {
      ...envOff,
      SCHEDULER_AI_CEO_MODE: "local",
      LOCAL_AGENT_EXECUTION_MODE: "local",
      CONTROLLED_AUTONOMY_MODE: "local",
    } as unknown as import("../src/lib/env.js").Env;
    const d = describeAutomationRuntime({ env, killEnabled: false, timerActive: false });
    expect(d.continuousAutomation).toBe(false);
    expect(d.reason).toBe("timer_inactive_manual_api_only");
  });

  it("24s pencere yokken kalıcı yerel grant ile timer+local kapılar armed olur", () => {
    const env = {
      ...envOff,
      SCHEDULER_AI_CEO_MODE: "local",
      LOCAL_AGENT_EXECUTION_MODE: "local",
      CONTROLLED_AUTONOMY_MODE: "local",
    } as unknown as import("../src/lib/env.js").Env;
    const blocked = describeAutomationRuntime({
      env,
      killEnabled: false,
      timerActive: true,
      windowActive: false,
    });
    expect(blocked.continuousAutomation).toBe(false);
    expect(blocked.reason).toBe("no_or_expired_autonomy_window");
    const allowed = describeAutomationRuntime({
      env,
      killEnabled: false,
      timerActive: true,
      windowActive: false,
      permanentLocalAutonomy: true,
    });
    expect(allowed.continuousAutomation).toBe(true);
  });

  it("timer + üç local kapı + kill/cloud kapalı = continuousAutomation true", () => {
    const env = {
      ...envOff,
      SCHEDULER_AI_CEO_MODE: "local",
      LOCAL_AGENT_EXECUTION_MODE: "local",
      CONTROLLED_AUTONOMY_MODE: "local",
    } as unknown as import("../src/lib/env.js").Env;
    const d = describeAutomationRuntime({ env, killEnabled: false, timerActive: true });
    expect(d.continuousAutomation).toBe(true);
    expect(d.triggerSource).toBe("timer");
  });
});
