import {
  CursorAgentSchema,
  CursorApiError,
  CursorCreateAgentResponseSchema,
  CursorRunSchema,
  CursorUsageSchema,
  type CreateAgentInput,
  type CursorAgent,
  type CursorCloudClient,
  type CursorCreateAgentResponse,
  type CursorRun,
  type CursorUsage,
} from "./types.js";
import { redactSecrets, safeErrorMessage } from "./sanitize.js";

const DEFAULT_BASE = "https://api.cursor.com";

interface LiveClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Canlı çağrı kilidi — false ise createAgent reddedilir. */
  liveCreateEnabled: boolean;
}

/**
 * Cursor Cloud Agents API v1 HTTP istemcisi.
 * createAgent yalnızca liveCreateEnabled=true iken çağrılır (Faz 4B).
 */
export class LiveCursorCloudClient implements CursorCloudClient {
  readonly mode = "live" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly liveCreateEnabled: boolean;

  constructor(options: LiveClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.liveCreateEnabled = options.liveCreateEnabled;
  }

  private authHeader(): string {
    // Basic: API_KEY: (boş şifre) — resmi dokümantasyon
    const token = Buffer.from(`${this.apiKey}:`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; schema?: { parse: (v: unknown) => T }; allowCreate?: boolean },
  ): Promise<T> {
    if (method === "POST" && path === "/v1/agents" && !this.liveCreateEnabled) {
      throw new CursorApiError(
        "CLOUD_AGENT_LIVE_ENABLED kapalı: gerçek Cloud Agent oluşturma engellendi.",
        403,
        "live_disabled",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
          ...(opts?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : undefined;
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text.slice(0, 200) };
        }
      }

      if (!res.ok) {
        const errObj = json as { error?: { code?: string; message?: string } } | null;
        const code = errObj?.error?.code ?? `http_${res.status}`;
        const message = redactSecrets(errObj?.error?.message ?? `Cursor API hata: ${res.status}`);
        throw new CursorApiError(message, res.status, code, Number.isFinite(retryAfterSec) ? retryAfterSec : undefined);
      }

      if (opts?.schema) return opts.schema.parse(json);
      return json as T;
    } catch (error) {
      if (error instanceof CursorApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new CursorApiError("Cursor API zaman aşımı.", 504, "timeout");
      }
      throw new CursorApiError(safeErrorMessage(error), 0, "network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request("GET", "/v1/agents?limit=1");
      return { ok: true, message: "Cursor API kimlik doğrulaması başarılı (liste okuma)." };
    } catch (error) {
      return { ok: false, message: safeErrorMessage(error) };
    }
  }

  async createAgent(input: CreateAgentInput): Promise<CursorCreateAgentResponse> {
    const body: Record<string, unknown> = {
      prompt: { text: input.promptText },
      repos: [
        {
          url: input.repositoryUrl,
          ...(input.startingRef ? { startingRef: input.startingRef } : {}),
        },
      ],
      autoCreatePR: input.autoCreatePR ?? false,
      workOnCurrentBranch: input.workOnCurrentBranch ?? false,
    };
    if (input.agentId) body.agentId = input.agentId;
    if (input.name) body.name = input.name.slice(0, 100);
    if (input.modelId) body.model = { id: input.modelId };

    return this.request("POST", "/v1/agents", {
      body,
      schema: CursorCreateAgentResponseSchema,
      allowCreate: true,
    });
  }

  async getAgent(agentId: string): Promise<CursorAgent> {
    return this.request("GET", `/v1/agents/${encodeURIComponent(agentId)}`, {
      schema: CursorAgentSchema,
    });
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    return this.request(
      "GET",
      `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
      { schema: CursorRunSchema },
    );
  }

  async listRuns(agentId: string): Promise<CursorRun[]> {
    const data = await this.request<{ items?: unknown[] }>(
      "GET",
      `/v1/agents/${encodeURIComponent(agentId)}/runs?limit=20`,
    );
    return (data.items ?? []).map((item) => CursorRunSchema.parse(item));
  }

  async cancelRun(agentId: string, runId: string): Promise<{ id: string }> {
    return this.request("POST", `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`);
  }

  async getUsage(agentId: string, runId?: string): Promise<CursorUsage | null> {
    const qs = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    try {
      return await this.request("GET", `/v1/agents/${encodeURIComponent(agentId)}/usage${qs}`, {
        schema: CursorUsageSchema,
      });
    } catch (error) {
      if (error instanceof CursorApiError && error.statusCode === 404) return null;
      throw error;
    }
  }
}
