import {
  isActiveCursorRun,
  mapCursorRunToDomain,
  type CloudConnectionStatus,
  type CursorRunStatus,
  type DispatchRequest,
  type DispatchResult,
  type TaskDispatcher,
} from "@synaptech/shared";
import { createHash, randomUUID } from "node:crypto";

import { getEnv } from "../lib/env.js";
import { assertRepositoryAllowed, getCursorCredentialStatus } from "./credentials.js";
import { LiveCursorCloudClient } from "./live-client.js";
import { MockCursorCloudClient } from "./mock-client.js";
import {
  assertPilotCreateOptions,
  PILOT_AUTO_CREATE_PR,
  PILOT_WORK_ON_CURRENT_BRANCH,
} from "./pilot-policy.js";
import { buildSafeCloudPrompt, safeErrorMessage } from "./sanitize.js";
import { CursorApiError, type CursorCloudClient, type CursorRun } from "./types.js";

export interface CloudAdapterStatus {
  connection: CloudConnectionStatus;
  liveEnabled: boolean;
  keyConfigured: boolean;
  mode: "mock" | "live";
  maxConcurrentRuns: 1;
  autoRetry: false;
  onDemandStatus: "Doğrulanamıyor" | "Kullanıcı doğruladı: kapalı bekleniyor";
  remainingUsageKnown: false;
  remainingUsageNote: string;
  allowedRepositories: string[];
  message: string;
}

export interface SyncRunResult {
  run: CursorRun;
  domain: ReturnType<typeof mapCursorRunToDomain>;
  unknownStatus: boolean;
}

/**
 * CursorCloudAdapter — Task Engine ile Cursor Cloud Agents API v1 köprüsü.
 * Varsayılan: mock. Live create yalnızca CLOUD_AGENT_LIVE_ENABLED + onay sonrası.
 */
export class CursorCloudAdapter implements TaskDispatcher {
  readonly target = "cursor-cloud" as const;
  readonly available = true;

  private client: CursorCloudClient;
  private mock: MockCursorCloudClient;
  /** In-flight create locks by idempotency / agent id. */
  private createLocks = new Set<string>();

  constructor(client?: CursorCloudClient) {
    this.mock = new MockCursorCloudClient();
    this.client = client ?? this.buildDefaultClient();
  }

  private buildDefaultClient(): CursorCloudClient {
    const env = getEnv();
    if (env.CURSOR_CLOUD_MODE === "mock" || !env.CLOUD_AGENT_LIVE_ENABLED) {
      return this.mock;
    }
    if (!env.CURSOR_API_KEY) {
      return this.mock;
    }
    return new LiveCursorCloudClient({
      apiKey: env.CURSOR_API_KEY,
      baseUrl: env.CURSOR_API_BASE_URL,
      liveCreateEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
    });
  }

  /** Test: mock istemcisini açığa çıkar. */
  getMockClient(): MockCursorCloudClient {
    return this.mock;
  }

  useMock() {
    this.client = this.mock;
  }

  useClient(client: CursorCloudClient) {
    this.client = client;
  }

  getStatus(): CloudAdapterStatus {
    const env = getEnv();
    const creds = getCursorCredentialStatus(env);
    let connection: CloudConnectionStatus = "not_configured";
    let message = "Cursor API anahtarı yapılandırılmamış.";

    if (creds.configured && !creds.liveEnabled) {
      connection = "configured_disabled";
      message = "API anahtarı var; gerçek Cloud çalıştırma varsayılan kapalı (Faz 4A).";
    } else if (this.client.mode === "mock") {
      connection = creds.configured ? "configured_disabled" : "mock";
      message = "Mock Cursor Cloud modu — ücretli çağrı yok.";
    } else if (creds.liveEnabled) {
      connection = "live_enabled";
      message = "Live mod bayrağı açık — yine de görev bazlı Owner onayı gerekir.";
    }

    return {
      connection,
      liveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
      keyConfigured: creds.configured,
      mode: this.client.mode,
      maxConcurrentRuns: 1,
      autoRetry: false,
      onDemandStatus: env.CLOUD_ON_DEMAND_VERIFIED
        ? "Kullanıcı doğruladı: kapalı bekleniyor"
        : "Doğrulanamıyor",
      remainingUsageKnown: false,
      remainingUsageNote:
        "Cursor hesabının gerçek kalan kullanımını programatik olarak sağlamıyor; pilot otomatik başlatılmaz.",
      allowedRepositories: creds.allowedRepositories,
      message,
    };
  }

  async verifyConnection(): Promise<{ ok: boolean; message: string; status: CloudAdapterStatus }> {
    const status = this.getStatus();
    if (this.client.mode === "live" && !status.keyConfigured) {
      return { ok: false, message: "API anahtarı yok.", status };
    }
    // Live verify yalnızca anahtar varken ve kullanıcı açıkça isterse; Faz 4A'da mock verify yeterli.
    if (this.client.mode === "live" && !status.liveEnabled) {
      return {
        ok: true,
        message: "Anahtar yapılandırıldı; live create kapalı — uzak doğrulama atlandı.",
        status,
      };
    }
    const result = await this.client.verifyConnection();
    return { ...result, status };
  }

  contentVersion(title: string, description: string): string {
    return createHash("sha256").update(`${title}\n${description}`, "utf8").digest("hex");
  }

  clientAgentIdFromTask(taskId: string): string {
    // Cursor: bc-<uuid> — task UUID'yi koru
    return `bc-${taskId}`;
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const env = getEnv();
    const status = this.getStatus();

    if (!request.approvalId) {
      return {
        ok: false,
        state: "awaiting_execution_approval",
        message: "Cloud Agent çalıştırma için Owner onayı (cloud_agent_run) gerekli.",
        mode: "awaiting_approval",
      };
    }

    if (!request.repositoryUrl) {
      return {
        ok: false,
        state: "failed",
        message: "İzinli repository URL zorunlu.",
        mode: "disabled",
      };
    }

    try {
      assertRepositoryAllowed(request.repositoryUrl, env.CLOUD_AGENT_ALLOWED_REPOS);
    } catch (error) {
      return {
        ok: false,
        state: "failed",
        message: safeErrorMessage(error),
        mode: "disabled",
      };
    }

    // Live kapalıysa mock ile altyapı testi (ücretli değil)
    const useLive = env.CLOUD_AGENT_LIVE_ENABLED && this.client.mode === "live";
    if (!useLive && this.client.mode !== "mock") {
      this.useMock();
    }

    const agentId = request.clientAgentId ?? this.clientAgentIdFromTask(request.taskId);
    if (this.createLocks.has(agentId)) {
      return {
        ok: false,
        state: "reconciliation_required",
        message: "Aynı agent için oluşturma zaten sürüyor — çift çalıştırma engellendi.",
        cursorAgentId: agentId,
        mode: useLive ? "live" : "mock",
      };
    }

    this.createLocks.add(agentId);
    try {
      const promptText = buildSafeCloudPrompt({
        taskId: request.taskId,
        title: request.title,
        description: request.description,
        projectSlug: request.projectSlug,
        agentRole: request.agentId,
      });

      const startingRef = (request.startingRef ?? env.CLOUD_AGENT_STARTING_REF).trim().toLowerCase();
      const createOptions = {
        promptText,
        repositoryUrl: request.repositoryUrl,
        startingRef,
        agentId,
        name: `SynapTech:${request.title}`.slice(0, 100),
        autoCreatePR: PILOT_AUTO_CREATE_PR,
        workOnCurrentBranch: PILOT_WORK_ON_CURRENT_BRANCH,
      };
      assertPilotCreateOptions(createOptions);

      const created = await this.client.createAgent(createOptions);

      return {
        ok: true,
        state: "dispatched",
        externalId: created.run.id,
        cursorAgentId: created.agent.id,
        cursorRunId: created.run.id,
        message: useLive
          ? "Cloud Agent run başlatıldı (live)."
          : "Mock Cloud Agent run başlatıldı (ücretli çağrı yok).",
        mode: useLive ? "live" : "mock",
      };
    } catch (error) {
      if (error instanceof CursorApiError && error.code === "agent_id_conflict") {
        return {
          ok: false,
          state: "reconciliation_required",
          message: "Cursor tarafında aynı agentId mevcut — uzlaştırma gerekli; kör yeniden başlatma yok.",
          cursorAgentId: agentId,
          mode: useLive ? "live" : "mock",
        };
      }
      if (error instanceof CursorApiError && error.code === "timeout") {
        return {
          ok: false,
          state: "reconciliation_required",
          message: "API zaman aşımı: run oluşmuş olabilir; otomatik yeniden deneme yok.",
          cursorAgentId: agentId,
          mode: useLive ? "live" : "mock",
        };
      }
      if (error instanceof CursorApiError && error.statusCode === 429) {
        return {
          ok: false,
          state: "failed",
          message: `Rate limit — Retry-After: ${error.retryAfterSec ?? "bilinmiyor"}s. Otomatik retry yok.`,
          mode: useLive ? "live" : "mock",
        };
      }
      return {
        ok: false,
        state: "failed",
        message: safeErrorMessage(error),
        mode: useLive ? "live" : "mock",
      };
    } finally {
      this.createLocks.delete(agentId);
    }
  }

  async getRun(agentId: string, runId: string): Promise<SyncRunResult> {
    const run = await this.client.getRun(agentId, runId);
    const known = [
      "CREATING",
      "RUNNING",
      "WAITING_FOR_BACKGROUND_WORK",
      "FINISHED",
      "ERROR",
      "CANCELLED",
      "EXPIRED",
    ] as const;
    if (!(known as readonly string[]).includes(run.status)) {
      return {
        run,
        domain: {
          dispatchState: "reconciliation_required",
          label: `Bilinmeyen Cursor durumu: ${run.status}`,
        },
        unknownStatus: true,
      };
    }
    return {
      run,
      domain: mapCursorRunToDomain(run.status as CursorRunStatus),
      unknownStatus: false,
    };
  }

  async cancelRun(agentId: string, runId: string): Promise<{ ok: boolean; message: string; verified: boolean }> {
    try {
      await this.client.cancelRun(agentId, runId);
      const run = await this.client.getRun(agentId, runId);
      const verified = run.status === "CANCELLED";
      return {
        ok: verified,
        verified,
        message: verified
          ? "İptal API'den doğrulandı (CANCELLED)."
          : `İptal çağrısı yapıldı; güncel durum: ${run.status}`,
      };
    } catch (error) {
      return { ok: false, verified: false, message: safeErrorMessage(error) };
    }
  }

  async getUsage(agentId: string, runId?: string) {
    return this.client.getUsage(agentId, runId);
  }

  isActiveStatus(status: string): boolean {
    return isActiveCursorRun(status as CursorRunStatus);
  }
}

let singleton: CursorCloudAdapter | null = null;

export function getCursorCloudAdapter(): CursorCloudAdapter {
  if (!singleton) singleton = new CursorCloudAdapter();
  return singleton;
}

export function resetCursorCloudAdapterForTests(): void {
  singleton = null;
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
