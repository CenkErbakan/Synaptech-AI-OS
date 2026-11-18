import { randomUUID } from "node:crypto";

import type {
  CreateAgentInput,
  CursorAgent,
  CursorCloudClient,
  CursorCreateAgentResponse,
  CursorRun,
  CursorUsage,
} from "./types.js";
import { CursorApiError } from "./types.js";

type MockScenario =
  | "success"
  | "auth_error"
  | "rate_limit"
  | "timeout"
  | "network"
  | "unauthorized_repo"
  | "cancel_ok"
  | "cancel_fail";

interface StoredAgent {
  agent: CursorAgent;
  runs: CursorRun[];
  usage?: CursorUsage;
}

/**
 * Deterministik mock Cursor Cloud API.
 * Gerçek ağ çağrısı yapmaz; ücretli run başlatmaz.
 */
export class MockCursorCloudClient implements CursorCloudClient {
  readonly mode = "mock" as const;
  private agents = new Map<string, StoredAgent>();
  private scenario: MockScenario = "success";
  private forceAuthInvalid = false;

  setScenario(scenario: MockScenario) {
    this.scenario = scenario;
  }

  setAuthInvalid(value: boolean) {
    this.forceAuthInvalid = value;
  }

  reset() {
    this.agents.clear();
    this.scenario = "success";
    this.forceAuthInvalid = false;
  }

  private assertAuth() {
    if (this.forceAuthInvalid || this.scenario === "auth_error") {
      throw new CursorApiError("Geçersiz veya süresi dolmuş Cursor API anahtarı.", 401, "unauthorized");
    }
  }

  private assertRepo(url: string) {
    if (this.scenario === "unauthorized_repo" || /synaptech|subify|marivo/i.test(url)) {
      throw new CursorApiError("Repository erişimi reddedildi.", 400, "repository_access");
    }
  }

  async verifyConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.forceAuthInvalid || this.scenario === "auth_error") {
      return { ok: false, message: "Kimlik bilgisi geçersiz (mock)." };
    }
    return { ok: true, message: "Mock Cursor Cloud bağlantısı hazır." };
  }

  async createAgent(input: CreateAgentInput): Promise<CursorCreateAgentResponse> {
    this.assertAuth();
    if (this.scenario === "timeout") {
      throw new CursorApiError("Cursor API zaman aşımı (mock).", 504, "timeout");
    }
    if (this.scenario === "network") {
      throw new CursorApiError("Ağ kesintisi (mock).", 0, "network_error");
    }
    if (this.scenario === "rate_limit") {
      throw new CursorApiError("Rate limit aşıldı (mock).", 429, "rate_limit_exceeded", 5);
    }
    this.assertRepo(input.repositoryUrl);

    const agentId = input.agentId ?? `bc-${randomUUID()}`;
    if (this.agents.has(agentId)) {
      throw new CursorApiError("agent_id_conflict", 409, "agent_id_conflict");
    }

    const runId = `run-${randomUUID()}`;
    const now = new Date().toISOString();
    const agent: CursorAgent = {
      id: agentId,
      name: input.name ?? input.promptText.slice(0, 80),
      status: "ACTIVE",
      url: `https://cursor.com/agents/${agentId}`,
      createdAt: now,
      updatedAt: now,
      latestRunId: runId,
      repos: [{ url: input.repositoryUrl, startingRef: input.startingRef ?? "main" }],
      autoCreatePR: input.autoCreatePR ?? false,
      workOnCurrentBranch: input.workOnCurrentBranch ?? false,
    };
    const run: CursorRun = {
      id: runId,
      agentId,
      status: "CREATING",
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agentId, {
      agent,
      runs: [run],
      usage: {
        totalUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
        },
        runs: [
          {
            id: runId,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 0,
            },
          },
        ],
      },
    });
    return { agent, run };
  }

  /** Test yardımcısı: run durumunu ilerlet. */
  advanceRun(agentId: string, status: CursorRun["status"], extras?: Partial<CursorRun>) {
    const stored = this.agents.get(agentId);
    if (!stored?.runs[0]) throw new Error("agent yok");
    const run = { ...stored.runs[0], status, updatedAt: new Date().toISOString(), ...extras };
    stored.runs[0] = run;
    stored.agent.latestRunId = run.id;
    stored.agent.status = status === "FINISHED" || status === "ERROR" || status === "CANCELLED" || status === "EXPIRED"
      ? "IDLE"
      : "ACTIVE";
    stored.agent.updatedAt = run.updatedAt;
  }

  async getAgent(agentId: string): Promise<CursorAgent> {
    this.assertAuth();
    const stored = this.agents.get(agentId);
    if (!stored) throw new CursorApiError("Agent bulunamadı.", 404, "agent_not_found");
    return stored.agent;
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    this.assertAuth();
    const stored = this.agents.get(agentId);
    const run = stored?.runs.find((r) => r.id === runId);
    if (!run) throw new CursorApiError("Run bulunamadı.", 404, "run_not_found");
    return run;
  }

  async listRuns(agentId: string): Promise<CursorRun[]> {
    this.assertAuth();
    const stored = this.agents.get(agentId);
    if (!stored) throw new CursorApiError("Agent bulunamadı.", 404, "agent_not_found");
    return [...stored.runs];
  }

  async cancelRun(agentId: string, runId: string): Promise<{ id: string }> {
    this.assertAuth();
    if (this.scenario === "cancel_fail") {
      throw new CursorApiError("run_not_cancellable", 409, "run_not_cancellable");
    }
    const stored = this.agents.get(agentId);
    const run = stored?.runs.find((r) => r.id === runId);
    if (!run) throw new CursorApiError("Run bulunamadı.", 404, "run_not_found");
    if (run.status === "FINISHED" || run.status === "ERROR" || run.status === "CANCELLED" || run.status === "EXPIRED") {
      throw new CursorApiError("run_not_cancellable", 409, "run_not_cancellable");
    }
    this.advanceRun(agentId, "CANCELLED");
    return { id: runId };
  }

  async getUsage(agentId: string, runId?: string): Promise<CursorUsage | null> {
    this.assertAuth();
    const stored = this.agents.get(agentId);
    if (!stored?.usage) return null;
    if (!runId) return stored.usage;
    const runUsage = stored.usage.runs.find((r) => r.id === runId);
    if (!runUsage) return null;
    return { totalUsage: runUsage.usage, runs: [runUsage] };
  }
}
