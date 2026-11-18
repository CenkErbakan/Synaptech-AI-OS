import type { Task } from "./tasks";

/**
 * Faz 4 Cursor Cloud Agent / yerel SDK dağıtım portu.
 * Gerçek ücretli Cloud çağrısı yalnızca live flag + Owner onay + kill switch kapalı iken.
 */
export type DispatchTarget = "cursor-cloud" | "cursor-sdk" | "none";

export interface DispatchRequest {
  taskId: string;
  agentId: string;
  projectSlug: string;
  title: string;
  description: string;
  priority: string;
  /** Görev içeriği sürümü (onay bağlama). */
  contentVersion?: string;
  /** İzinli test repository URL (Owner onayında bound). */
  repositoryUrl?: string;
  /** Base ref (main|master). Üzerine yazılmaz; agent branch üretilir. */
  startingRef?: string;
  /** Idempotent agentId (bc-<uuid>). */
  clientAgentId?: string;
  approvalId?: string;
}

export interface DispatchResult {
  ok: boolean;
  state: Task["dispatchState"];
  externalId?: string;
  cursorAgentId?: string;
  cursorRunId?: string;
  message: string;
  mode?: "mock" | "live" | "disabled" | "awaiting_approval";
}

export interface TaskDispatcher {
  readonly target: DispatchTarget;
  readonly available: boolean;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
}

/** Faz 3 uyumluluğu: entegrasyon yok. */
export class UnavailableDispatcher implements TaskDispatcher {
  readonly target: DispatchTarget = "none";
  readonly available = false;

  async dispatch(_request: DispatchRequest): Promise<DispatchResult> {
    return {
      ok: false,
      state: "awaiting_integration",
      message: "Cursor entegrasyonu Faz 4'te bağlanacak; görev planlandı olarak bekliyor.",
      mode: "disabled",
    };
  }
}

export interface TrustedExecutorRequest {
  approvalId: string;
  type: string;
  boundVersion: string;
  payloadRef: string;
}

export interface TrustedExecutorResult {
  executed: boolean;
  message: string;
}

/** Onaylı işlemleri yürüten güvenilir yürütücü — production işlemleri Faz 4A'da da no-op. */
export interface TrustedExecutor {
  execute(request: TrustedExecutorRequest): Promise<TrustedExecutorResult>;
}

export class Phase3NoopExecutor implements TrustedExecutor {
  async execute(_request: TrustedExecutorRequest): Promise<TrustedExecutorResult> {
    return {
      executed: false,
      message: "Production işlemi yürütülmez; onay kaydı tutulur. Cloud run ayrı kapıdan geçer.",
    };
  }
}
