import { describe, expect, it } from "vitest";
import { CeoPlanSchema } from "@synaptech/shared";

import { MockModelProvider } from "../src/ai/providers/mock-provider.js";
import { isRealAiCompletion } from "../src/ai/model-provider.js";

describe("Faz 5E ModelProvider unit", () => {
  it("mock CEO planı JSON Schema ile geçer ve realAiExecution=false", async () => {
    const provider = new MockModelProvider();
    const completion = await provider.generateCeoPlan({
      goals: [
        {
          goalKey: "os-reliability",
          projectSlug: "synaptech-ai-os",
          title: "güvenilirlik",
          dataSource: "mssql",
        },
      ],
      opportunities: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "test fırsat",
          projectSlug: "synaptech-ai-os",
          evidenceRef: "project:x",
        },
      ],
      openTaskCount: 2,
    });
    expect(completion.realAiExecution).toBe(false);
    expect(isRealAiCompletion(completion)).toBe(false);
    const plan = CeoPlanSchema.parse(completion.parsedPlan);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    expect(plan.estimatedAiCost).toBe("none");
  });

  it("Cloud Agents API ModelProvider değildir (yetenek sözleşmesi)", () => {
    const p = new MockModelProvider();
    const caps = p.capabilities();
    expect(caps.codeAgent).toBe(false);
    expect(caps.structuredPlan).toBe(true);
    expect(caps.paidNetworkCall).toBe(false);
  });

  it("geçersiz CEO planı schema ile reddedilir", () => {
    expect(() =>
      CeoPlanSchema.parse({
        summary: "x",
        tasks: [],
      }),
    ).toThrow();
  });

  it("local probe başarısızken mock provider döndürmez (sözleşme)", async () => {
    const { LocalModelProvider } = await import("../src/ai/providers/local-provider.js");
    const local = new LocalModelProvider("http://127.0.0.1:9", "qwen2.5:14b");
    const probe = await local.probe();
    expect(probe.ok).toBe(false);
    expect(probe.message.length).toBeGreaterThan(5);
    // generateCeoPlan mock üretmez — hata fırlatır
    await expect(local.generateCeoPlan({ goals: [], opportunities: [], openTaskCount: 0 })).rejects.toThrow(
      /local_llm_unavailable/,
    );
  });
});
