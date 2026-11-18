import { AgentWorkResultSchema, CeoPlanSchema, type ModelCompletion } from "@synaptech/shared";

import { buildCeoPlanPrompt } from "../ceo-plan-prompt.js";
import { errorCodeForExtract, extractCeoPlanJson } from "../ceo-json-extract.js";
import { CEO_PLAN_OLLAMA_FORMAT } from "../ceo-plan-json-schema.js";
import type { AgentWorkRequest, ChatRequest, ModelProvider, PlanRequest } from "../model-provider.js";

export const LOCAL_LLM_GENERATE_TIMEOUT_MS = 180_000;
export const CEO_PLAN_NUM_PREDICT = 640;
export const AGENT_WORK_NUM_PREDICT = 900;

export type OllamaGenerateMetrics = {
  promptEvalCount: number | null;
  evalCount: number | null;
  promptEvalDurationMs: number | null;
  evalDurationMs: number | null;
  totalDurationMs: number | null;
  loadDurationMs: number | null;
};

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = globalThis.fetch.bind(globalThis);
let generatesInFlight = 0;

export function setLocalProviderFetchForTests(fn: FetchLike | null): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
}

export function resetLocalProviderInFlightForTests(): void {
  generatesInFlight = 0;
}

export function localProviderGeneratesInFlight(): number {
  return generatesInFlight;
}

const SAFETY_RULES = [
  "Onay, izin, bütçe, kill switch, Cloud Agent, On-Demand, GitHub allow-list veya yayın kararını KENDİN VERME / DEĞİŞTİRME.",
  "requiresOwnerApproval her zaman true olmalı.",
  "estimatedAiCost local_compute veya none olabilir; cloud_unknown/external_paid önerme.",
  "Yalnızca verilen MSSQL bağlamındaki kanıtlara dayan; uydurma metrik yazma.",
  "Production deploy, müşteri mesajı, reklam veya blog yayını önerme/yürütme.",
].join(" ");

/**
 * Yerel LLM köprüsü (Ollama uyumlu HTTP).
 * Harici ücretli API yok. Bağlantı yoksa hata — sessiz mock yok.
 */
/** Modelin ürettiği priority/alias sapmalarını şemaya çek (mock üretmez). */
export function normalizeLocalCeoPlanJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (typeof obj.summary === "string") obj.summary = obj.summary.slice(0, 240);
  const tasks = Array.isArray(obj.tasks) ? obj.tasks.slice(0, 8) : [];
  obj.tasks = tasks.map((t) => {
    if (!t || typeof t !== "object") return t;
    const task = { ...(t as Record<string, unknown>) };
    const p = String(task.priority ?? "medium").toLowerCase().trim();
    if (["low", "düşük", "dusuk"].includes(p)) task.priority = "low";
    else if (["high", "critical", "urgent", "yüksek", "yuksek", "kritik"].includes(p)) {
      task.priority = "high";
    } else task.priority = "medium";
    if (typeof task.title === "string") task.title = task.title.slice(0, 140);
    if (typeof task.description === "string") task.description = task.description.slice(0, 400);
    if (typeof task.acceptanceCriteria === "string") {
      task.acceptanceCriteria = task.acceptanceCriteria.slice(0, 400);
    }
    if (typeof task.evidenceHint === "string") task.evidenceHint = task.evidenceHint.slice(0, 200);
    return task;
  });
  if (Array.isArray(obj.risks)) {
    obj.risks = obj.risks.map((r) => String(r).slice(0, 200)).slice(0, 8);
  }
  obj.requiresOwnerApproval = true;
  obj.estimatedAiCost = obj.estimatedAiCost === "none" ? "none" : "local_compute";
  return obj;
}

function stringifyListItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (item == null) return "";
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (typeof item === "object") {
    const rec = item as Record<string, unknown>;
    const preferred =
      rec.text ?? rec.title ?? rec.summary ?? rec.recommendation ?? rec.risk ?? rec.message;
    if (typeof preferred === "string" && preferred.trim()) return preferred;
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  }
  return String(item);
}

/** Ajan çıktısındaki object[] sapmalarını string[] şemasına çek (mock üretmez). */
export function normalizeAgentWorkJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(obj.recommendations)) {
    obj.recommendations = obj.recommendations.map(stringifyListItem).filter(Boolean).slice(0, 12);
  }
  if (Array.isArray(obj.risks)) {
    obj.risks = obj.risks.map(stringifyListItem).filter(Boolean).slice(0, 12);
  }
  if (Array.isArray(obj.evidenceUsed)) {
    obj.evidenceUsed = obj.evidenceUsed.map(stringifyListItem).filter(Boolean).slice(0, 20);
  }
  if (typeof obj.summary !== "string" && obj.summary != null) {
    obj.summary = stringifyListItem(obj.summary);
  }
  if (typeof obj.analysis !== "string" && obj.analysis != null) {
    obj.analysis = stringifyListItem(obj.analysis);
  }
  if (typeof obj.acceptanceNotes !== "string" && obj.acceptanceNotes != null) {
    obj.acceptanceNotes = stringifyListItem(obj.acceptanceNotes);
  }
  // Eksik zorunlu alanlar → fail-closed (uydurma bulgu yok)
  if (typeof obj.summary !== "string" || !String(obj.summary).trim()) {
    obj.summary = "incomplete_model_json";
    obj.acceptanceMet = false;
  }
  if (typeof obj.analysis !== "string" || !String(obj.analysis).trim()) {
    obj.analysis = "incomplete_model_json";
    obj.acceptanceMet = false;
  }
  if (typeof obj.acceptanceNotes !== "string") obj.acceptanceNotes = "";
  if (typeof obj.acceptanceMet !== "boolean") obj.acceptanceMet = false;
  const fk = String(obj.findingKind ?? "none");
  if (
    !["structure_inspection", "dependency_analysis", "verified_defect", "none"].includes(fk)
  ) {
    obj.findingKind = "none";
  } else {
    obj.findingKind = fk;
  }
  if (!Array.isArray(obj.proposedPatches)) obj.proposedPatches = [];
  else {
    obj.proposedPatches = obj.proposedPatches
      .filter((p) => p && typeof p === "object")
      .slice(0, 5)
      .map((p) => {
        const row = p as Record<string, unknown>;
        return {
          path: String(row.path ?? "").slice(0, 400),
          content: String(row.content ?? "").slice(0, 80_000),
          reason: row.reason != null ? String(row.reason).slice(0, 500) : undefined,
        };
      })
      .filter((p) => p.path && p.content.length > 0);
  }
  obj.codeChangeApplied = false;
  obj.requiresOwnerApproval = true;
  return obj;
}

export class LocalModelProvider implements ModelProvider {
  readonly id = "local" as const;
  readonly displayName = "Yerel LLM (Ollama-uyumlu; ücretli bulut yok)";

  constructor(
    private readonly baseUrl: string,
    private readonly modelId: string,
  ) {}

  capabilities() {
    return {
      structuredPlan: true,
      chat: true,
      codeAgent: false,
      paidNetworkCall: false,
      remainingUsageKnown: false,
    };
  }

  async probe(): Promise<{ ok: boolean; message: string; installedModels?: string[] }> {
    if (!this.baseUrl) {
      return { ok: false, message: "LOCAL_LLM_BASE_URL tanımlı değil." };
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, {
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return { ok: false, message: `Yerel LLM HTTP ${res.status}` };
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
      const modelPresent = names.some(
        (n) => n === this.modelId || n.startsWith(`${this.modelId}:`) || n.startsWith(this.modelId),
      );
      if (names.length === 0) {
        return {
          ok: false,
          message: `Ollama erişilebilir ama hiç model yok. Hedef model: ${this.modelId}`,
          installedModels: names,
        };
      }
      if (!modelPresent) {
        return {
          ok: false,
          message: `Model yüklü değil: ${this.modelId}. Kurulu: ${names.slice(0, 12).join(", ") || "(yok)"}`,
          installedModels: names,
        };
      }
      return {
        ok: true,
        message: `Yerel LLM hazır: ${this.modelId} @ ${this.baseUrl}`,
        installedModels: names,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Yerel LLM yok/erişilemez: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async complete(
    prompt: string,
    opts?: {
      json?: boolean;
      stream?: boolean;
      format?: unknown;
      timeoutMs?: number;
      numPredict?: number;
      onHeartbeat?: () => void | Promise<void>;
    },
  ): Promise<{ text: string; durationMs: number; metrics: OllamaGenerateMetrics; aborted: boolean }> {
    if (generatesInFlight > 0) {
      throw new Error("local_llm_duplicate_in_flight");
    }
    generatesInFlight += 1;
    const started = Date.now();
    const timeoutMs = opts?.timeoutMs ?? LOCAL_LLM_GENERATE_TIMEOUT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const beat = setInterval(() => {
      void (async () => {
        await opts?.onHeartbeat?.();
        const { renewLocalLlmCallLease } = await import("../llm-call-guard.js");
        await renewLocalLlmCallLease();
      })().catch(() => undefined);
    }, 20_000);
    let aborted = false;
    try {
      const useStream = opts?.stream ?? !opts?.json;
      const format = opts?.format ?? (opts?.json ? "json" : undefined);
      const res = await fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          model: this.modelId,
          prompt,
          stream: useStream,
          keep_alive: "10m",
          ...(format !== undefined ? { format } : {}),
          options: {
            temperature: 0.1,
            num_predict: opts?.numPredict ?? CEO_PLAN_NUM_PREDICT,
            num_ctx: 4096,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`local_llm_http_${res.status}`);
      }
      if (!useStream) {
        const json = (await res.json()) as Record<string, unknown>;
        const text = responseTextFromOllamaPayload(json);
        return {
          text,
          durationMs: Date.now() - started,
          metrics: metricsFromOllamaChunk(json),
          aborted: false,
        };
      }
      const parsedStream = await readOllamaGenerateStream(res, ac.signal);
      if (parsedStream.aborted || ac.signal.aborted) {
        throw new Error(`local_llm_timeout:${timeoutMs}`);
      }
      return {
        text: parsedStream.text,
        durationMs: Date.now() - started,
        metrics: parsedStream.metrics,
        aborted: false,
      };
    } catch (error) {
      aborted = ac.signal.aborted;
      if (aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new Error(`local_llm_timeout:${timeoutMs}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(beat);
      generatesInFlight = Math.max(0, generatesInFlight - 1);
      void aborted;
    }
  }

  async generateCeoPlan(
    request: PlanRequest,
    runtime?: { onHeartbeat?: () => void | Promise<void> },
  ): Promise<ModelCompletion> {
    const probe = await this.probe();
    if (!probe.ok) {
      throw new Error(`local_llm_unavailable:${probe.message}`);
    }
    const built = buildCeoPlanPrompt(request);
    const { text: content, durationMs, metrics } = await this.complete(built.prompt, {
      json: true,
      stream: false,
      format: CEO_PLAN_OLLAMA_FORMAT,
      timeoutMs: LOCAL_LLM_GENERATE_TIMEOUT_MS,
      numPredict: CEO_PLAN_NUM_PREDICT,
      onHeartbeat: runtime?.onHeartbeat,
    });
    const extracted = extractCeoPlanJson(content);
    if (!extracted.jsonText) {
      throw Object.assign(new Error(errorCodeForExtract(extracted.kind)), {
        extract: extracted,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.jsonText);
    } catch {
      throw Object.assign(new Error("local_llm_invalid_json"), { extract: extracted });
    }
    const normalized = normalizeLocalCeoPlanJson(parsed);
    let parsedPlan;
    try {
      parsedPlan = CeoPlanSchema.parse(normalized);
    } catch (err) {
      throw Object.assign(
        new Error(
          `schema_validation_failed:${err instanceof Error ? err.message.slice(0, 180) : "zod"}`,
        ),
        { extract: extracted },
      );
    }
    return {
      providerId: "local",
      modelId: this.modelId,
      realAiExecution: true,
      content,
      parsedPlan,
      evidence: [
        { kind: "audit", ref: `local_llm:${this.modelId}` },
        { kind: "mssql", ref: "ceo_plan_context" },
        { kind: "artifact", ref: `durationMs:${durationMs}` },
        { kind: "artifact", ref: `promptChars:${built.promptChars}` },
        { kind: "artifact", ref: `jsonKind:${extracted.kind}` },
        { kind: "artifact", ref: `contentLen:${extracted.contentLen}` },
        { kind: "artifact", ref: `contentSha256:${extracted.contentSha256}` },
        ...metricsToEvidence(metrics),
      ],
      usage: {
        inputTokens: metrics.promptEvalCount ?? 0,
        outputTokens: metrics.evalCount ?? 0,
      },
    };
  }

  async chat(request: ChatRequest): Promise<ModelCompletion> {
    const probe = await this.probe();
    if (!probe.ok) throw new Error(`local_llm_unavailable:${probe.message}`);
    const prompt = [
      "Sen SynapTech AI OS yerel AI CEO sohbet asistanısın. Türkçe yanıt ver.",
      SAFETY_RULES,
      "Onay/bütçe/Cloud değişikliği yapamazsın; yalnızca öneri sunarsın.",
      `Bağlam:\n${request.contextSummary}`,
      `Kullanıcı: ${request.message}`,
    ].join("\n");
    const { text: content, durationMs, metrics } = await this.complete(prompt, { json: false, numPredict: 400 });
    return {
      providerId: "local",
      modelId: this.modelId,
      realAiExecution: true,
      content,
      evidence: [
        { kind: "audit", ref: `local_llm_chat:${this.modelId}` },
        { kind: "artifact", ref: `durationMs:${durationMs}` },
        ...metricsToEvidence(metrics),
      ],
      usage: {
        inputTokens: metrics.promptEvalCount ?? 0,
        outputTokens: metrics.evalCount ?? 0,
      },
    };
  }

  async executeAgentWork(request: AgentWorkRequest) {
    const probe = await this.probe();
    if (!probe.ok) throw new Error(`local_llm_unavailable:${probe.message}`);
    const prompt = [
      request.systemPrompt,
      SAFETY_RULES,
      "Yalnızca JSON döndür. Alanlar: summary, analysis, recommendations[], acceptanceMet, acceptanceNotes, codeChangeApplied(false), evidenceUsed[], risks[], requiresOwnerApproval(true), findingKind(structure_inspection|dependency_analysis|verified_defect|none), proposedPatches[{path,content,reason?}].",
      "recommendations ve risks yalnızca düz metin string dizisi olmalı; nesne/dict kullanma.",
      "findingKind: yapı/bağımlılık envanteri ile doğrulanmış defect'i ayır. proposedPatches yalnızca sandbox için; ana repo yazma.",
      `agentId=${request.agentId}`,
      `task=${JSON.stringify(request.task)}`,
      `context=${request.contextSummary}`,
    ].join("\n");
    const { text: content, durationMs, metrics } = await this.complete(prompt, {
      json: true,
      numPredict: AGENT_WORK_NUM_PREDICT,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("local_llm_invalid_agent_json");
    }
    const normalized = normalizeAgentWorkJson(parsed);
    let parsedWork;
    try {
      parsedWork = AgentWorkResultSchema.parse(normalized);
    } catch (err) {
      throw new Error(
        `local_llm_agent_schema_invalid:${err instanceof Error ? err.message.slice(0, 240) : "zod"}`,
      );
    }
    return {
      providerId: "local" as const,
      modelId: this.modelId,
      realAiExecution: true,
      content,
      parsedWork,
      evidence: [
        { kind: "audit" as const, ref: `local_agent:${request.agentId}:${this.modelId}` },
        { kind: "mssql" as const, ref: `task:${request.task.id}` },
        { kind: "artifact" as const, ref: `durationMs:${durationMs}` },
        ...metricsToEvidence(metrics),
      ],
      usage: {
        inputTokens: metrics.promptEvalCount ?? 0,
        outputTokens: metrics.evalCount ?? 0,
      },
    };
  }
}

function nsToMs(ns: unknown): number | null {
  if (typeof ns !== "number" || !Number.isFinite(ns)) return null;
  return Math.round(ns / 1_000_000);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function metricsFromOllamaChunk(chunk: Record<string, unknown>): OllamaGenerateMetrics {
  return {
    promptEvalCount: numOrNull(chunk.prompt_eval_count),
    evalCount: numOrNull(chunk.eval_count),
    promptEvalDurationMs: nsToMs(chunk.prompt_eval_duration),
    evalDurationMs: nsToMs(chunk.eval_duration),
    totalDurationMs: nsToMs(chunk.total_duration),
    loadDurationMs: nsToMs(chunk.load_duration),
  };
}

export function metricsToEvidence(metrics: OllamaGenerateMetrics) {
  const parts: Array<{ kind: "artifact"; ref: string }> = [];
  if (metrics.promptEvalCount != null) parts.push({ kind: "artifact", ref: `prompt_eval_count:${metrics.promptEvalCount}` });
  if (metrics.evalCount != null) parts.push({ kind: "artifact", ref: `eval_count:${metrics.evalCount}` });
  if (metrics.promptEvalDurationMs != null) {
    parts.push({ kind: "artifact", ref: `prompt_eval_ms:${metrics.promptEvalDurationMs}` });
  }
  if (metrics.evalDurationMs != null) parts.push({ kind: "artifact", ref: `eval_ms:${metrics.evalDurationMs}` });
  if (metrics.totalDurationMs != null) parts.push({ kind: "artifact", ref: `ollama_total_ms:${metrics.totalDurationMs}` });
  if (metrics.loadDurationMs != null) parts.push({ kind: "artifact", ref: `load_ms:${metrics.loadDurationMs}` });
  return parts;
}

export function responseTextFromOllamaPayload(chunk: Record<string, unknown>): string {
  if (typeof chunk.response === "string") return chunk.response;
  if (chunk.response && typeof chunk.response === "object") {
    try {
      return JSON.stringify(chunk.response);
    } catch {
      return "";
    }
  }
  return "";
}

export async function readOllamaGenerateStream(
  res: Response,
  signal?: AbortSignal,
): Promise<{ text: string; metrics: OllamaGenerateMetrics; aborted: boolean }> {
  const empty: OllamaGenerateMetrics = {
    promptEvalCount: null,
    evalCount: null,
    promptEvalDurationMs: null,
    evalDurationMs: null,
    totalDurationMs: null,
    loadDurationMs: null,
  };
  if (!res.body) {
    const json = (await res.json()) as Record<string, unknown>;
    return {
      text: String(json.response ?? ""),
      metrics: metricsFromOllamaChunk(json),
      aborted: false,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let metrics = empty;
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return { text, metrics, aborted: true };
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }
        text += responseTextFromOllamaPayload(chunk);
        if (chunk.done === true) metrics = metricsFromOllamaChunk(chunk);
      }
    }
    if (buf.trim()) {
      try {
        const chunk = JSON.parse(buf.trim()) as Record<string, unknown>;
        text += responseTextFromOllamaPayload(chunk);
        if (chunk.done === true) metrics = metricsFromOllamaChunk(chunk);
      } catch {
        if (!text) text = buf.trim();
      }
    }
    return { text, metrics, aborted: false };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      await reader.cancel().catch(() => undefined);
      return { text, metrics, aborted: true };
    }
    throw error;
  }
}
