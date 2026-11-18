import { AgentWorkResultSchema, CeoPlanSchema, type ModelCompletion } from "@synaptech/shared";

import type { AgentWorkRequest, ChatRequest, ModelProvider, PlanRequest } from "../model-provider.js";

/**
 * Mock ModelProvider — gerçek LLM / Cloud / ücretli API çağrısı YOK.
 * Pipeline ve JSON Schema doğrulamasını güvenli test eder.
 */
export class MockModelProvider implements ModelProvider {
  readonly id = "mock" as const;
  readonly displayName = "Mock ModelProvider (ücretli çağrı yok)";

  capabilities() {
    return {
      structuredPlan: true,
      chat: true,
      codeAgent: false,
      paidNetworkCall: false,
      remainingUsageKnown: true,
    };
  }

  async probe() {
    return { ok: true, message: "Mock provider hazır; gerçek AI yürütmesi değildir." };
  }

  async generateCeoPlan(request: PlanRequest): Promise<ModelCompletion> {
    const opp = request.opportunities[0];
    const goal = request.goals[0];
    const projectSlug = (opp?.projectSlug ?? goal?.projectSlug ?? "synaptech-ai-os") as
      | "synaptech-ai-os"
      | "synaptech"
      | "subify"
      | "marivo";
    const raw = {
      summary: `Mock CEO planı: ${opp?.title ?? goal?.title ?? "operasyonel değerlendirme"}`,
      goalsAddressed: request.goals.slice(0, 3).map((g) => g.goalKey),
      tasks: [
        {
          title: [
            "CTO incelemesi",
            String(request.instruction ?? "mock").match(/cycle=([^\s]+)/)?.[1] ?? "mock",
            (opp?.title ?? "sistem sağlığı").slice(0, 60),
          ]
            .join(" · ")
            .slice(0, 140),
          description: [
            "Mock LLM çıktısı — gerçek model değil.",
            opp?.evidenceRef ? `Kanıt ipucu: ${opp.evidenceRef}` : "Kanıt: MSSQL opportunity/goal snapshot",
            request.instruction ?? "",
          ]
            .filter(Boolean)
            .join("\n"),
          projectSlug,
          assigneeId: "cto" as const,
          priority: "medium" as const,
          acceptanceCriteria: "Teknik plan maddeleri yazılmış; gerçek AI iddiası yok.",
          evidenceHint: opp?.id != null ? `opportunity:${opp.id}` : "mssql:CompanyGoal",
        },
      ],
      risks: ["Mock plan üretimidir; canlı Cloud Agent başlatılmaz."],
      requiresOwnerApproval: true,
      estimatedAiCost: "none" as const,
    };
    const parsedPlan = CeoPlanSchema.parse(raw);
    return {
      providerId: "mock",
      modelId: "mock-ceo-v1",
      realAiExecution: false,
      content: JSON.stringify(parsedPlan),
      parsedPlan,
      evidence: [
        { kind: "mssql", ref: opp ? `opportunity:${opp.id}` : "opportunity:none" },
        { kind: "audit", ref: "model_provider:mock" },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async chat(request: ChatRequest): Promise<ModelCompletion> {
    const reply = [
      "[Mock ModelProvider — gerçek LLM yanıtı değil]",
      "",
      `Mesajınız alındı (${request.message.slice(0, 200)}).`,
      "Bağlam özeti kullanıldı; ücretli model çağrısı yok.",
      request.contextSummary.slice(0, 500),
    ].join("\n");
    return {
      providerId: "mock",
      modelId: "mock-ceo-chat-v1",
      realAiExecution: false,
      content: reply,
      evidence: [{ kind: "audit", ref: "ceo_chat:mock" }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async executeAgentWork(request: AgentWorkRequest) {
    const isDevSandbox =
      request.agentId === "developer" &&
      /sandbox|fixture|demo/i.test(`${request.task.title} ${request.task.description ?? ""}`);
    const draftByAgent: Record<string, string> = {
      "growth-lead": "research_brief",
      "seo-specialist": "seo_findings",
      "content-manager": "content_draft",
      "ads-manager": "ads_campaign_draft",
      security: "security_risk_review",
    };
    const draftKind = draftByAgent[request.agentId] ?? "none";
    const longAnalysis =
      draftKind !== "none"
        ? [
            `Mock ${request.agentId} doğrulanabilir taslak analizi.`,
            "Gerçek model değildir; yayın/harcama/ileti yapılmaz.",
            "Owner onayı olmadan blog_publish, ad_campaign_launch veya customer_message yok.",
            `Görev: ${request.task.title}. Kabul: yapısal şema + requiresOwnerApproval=true.`,
            "Kanıt: MSSQL task bağlamı ve mock provider audit ref.",
          ].join(" ")
        : request.agentId === "cto"
          ? "Mock CTO structure_inspection — package.json ve README yolları."
          : isDevSandbox
            ? "Mock developer: src/demo.js add() düzeltmesi önerildi (sandbox)."
            : "Mock ajan analizi — gerçek model değil. Kabul kriterleri bu kanalda otomatik doğrulanmış sayılmaz.";
    const parsedWork = AgentWorkResultSchema.parse({
      summary: `Mock ${request.agentId} çıktısı: ${request.task.title}`.slice(0, 400),
      analysis: longAnalysis,
      recommendations: ["Owner incelemesi", "Gerçek local pilot ayrı onayla"],
      acceptanceMet: false,
      acceptanceNotes: "Mock: model acceptanceMet false — bağımsız kanıt belirler.",
      codeChangeApplied: false,
      evidenceUsed: [`task:${request.task.id}`, "provider:mock"],
      risks:
        request.agentId === "security"
          ? ["Secret sızıntısı riski taranmalı", "Mock güvenlik incelemesi"]
          : ["Mock çıktı üretimidir"],
      requiresOwnerApproval: true,
      findingKind: request.agentId === "cto" ? "structure_inspection" : "none",
      draftKind,
      proposedPatches: isDevSandbox
        ? [
            {
              path: "src/demo.js",
              content: "export function add(a, b) {\n  return a + b;\n}\n",
              reason: "fixture fix",
            },
          ]
        : [],
    });
    return {
      providerId: "mock" as const,
      modelId: `mock-agent-${request.agentId}`,
      realAiExecution: false,
      content: JSON.stringify(parsedWork),
      parsedWork,
      evidence: [
        { kind: "audit" as const, ref: `mock_agent:${request.agentId}` },
        { kind: "mssql" as const, ref: `task:${request.task.id}` },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
