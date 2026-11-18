import { AgentWorkResultSchema, CeoPlanSchema, type ModelCompletion } from "@synaptech/shared";

import type { AgentWorkRequest, ChatRequest, ModelProvider, PlanRequest } from "../model-provider.js";

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
  const tasks = Array.isArray(obj.tasks) ? obj.tasks.slice(0, 3) : [];
  obj.tasks = tasks.map((t) => {
    if (!t || typeof t !== "object") return t;
    const task = { ...(t as Record<string, unknown>) };
    const p = String(task.priority ?? "medium").toLowerCase().trim();
    if (["low", "düşük", "dusuk"].includes(p)) task.priority = "low";
    else if (["high", "critical", "urgent", "yüksek", "yuksek", "kritik"].includes(p)) {
      task.priority = "high";
    } else task.priority = "medium";
    return task;
  });
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
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, {
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
    opts?: { json?: boolean },
  ): Promise<{ text: string; durationMs: number }> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        prompt,
        stream: false,
        ...(opts?.json ? { format: "json" } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`local_llm_http_${res.status}`);
    }
    const json = (await res.json()) as { response?: string };
    return { text: json.response ?? "", durationMs: Date.now() - started };
  }

  async generateCeoPlan(request: PlanRequest): Promise<ModelCompletion> {
    const probe = await this.probe();
    if (!probe.ok) {
      throw new Error(`local_llm_unavailable:${probe.message}`);
    }
    const prompt = [
      "Sen SynapTech AI OS yerel AI CEO'susun. Yalnızca JSON döndür.",
      SAFETY_RULES,
      "Şema alanları: summary, goalsAddressed[], tasks[{title,description,projectSlug,assigneeId,priority,acceptanceCriteria,evidenceHint?}], risks[], requiresOwnerApproval, estimatedAiCost.",
      "projectSlug yalnızca: synaptech-ai-os|synaptech|subify|marivo",
      "assigneeId: ceo|cto|developer|tester|security|growth-lead|seo-specialist|content-manager|ads-manager",
      "priority yalnızca: low|medium|high (critical/urgent/yüksek yazma).",
      "tasks dizisinde en fazla 3 madde üret.",
      "Bağlam (MSSQL özeti):",
      JSON.stringify({
        goals: request.goals,
        opportunities: request.opportunities,
        openTaskCount: request.openTaskCount,
        instruction: request.instruction ?? null,
      }),
    ].join("\n");
    const { text: content, durationMs } = await this.complete(prompt, { json: true });
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("local_llm_invalid_json");
    }
    const normalized = normalizeLocalCeoPlanJson(parsed);
    const parsedPlan = CeoPlanSchema.parse(normalized);
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
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
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
    const { text: content, durationMs } = await this.complete(prompt, { json: false });
    return {
      providerId: "local",
      modelId: this.modelId,
      realAiExecution: true,
      content,
      evidence: [
        { kind: "audit", ref: `local_llm_chat:${this.modelId}` },
        { kind: "artifact", ref: `durationMs:${durationMs}` },
      ],
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
    const { text: content, durationMs } = await this.complete(prompt, { json: true });
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
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
