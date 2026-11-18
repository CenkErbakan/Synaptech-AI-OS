/** Ollama `format` alanı — yerel 0.40.x structured output. Zod CeoPlan ile hizalı, kısa. */
export const CEO_PLAN_OLLAMA_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tasks", "requiresOwnerApproval", "estimatedAiCost"],
  properties: {
    summary: { type: "string" },
    goalsAddressed: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "projectSlug",
          "assigneeId",
          "priority",
          "acceptanceCriteria",
          "evidenceHint",
        ],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          projectSlug: {
            type: "string",
            enum: ["synaptech-ai-os", "synaptech", "subify", "marivo"],
          },
          assigneeId: {
            type: "string",
            enum: [
              "cto",
              "developer",
              "tester",
              "security",
              "growth-lead",
              "seo-specialist",
              "content-manager",
              "ads-manager",
            ],
          },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          acceptanceCriteria: { type: "string" },
          evidenceHint: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    requiresOwnerApproval: { type: "boolean" },
    estimatedAiCost: { type: "string", enum: ["none", "local_compute"] },
  },
} as const;
