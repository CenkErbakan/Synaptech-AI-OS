import { afterEach, describe, expect, it } from "vitest";
import { CeoPlanSchema } from "@synaptech/shared";

import {
  classifyPersistError,
  extractCeoPlanJson,
} from "../src/ai/ceo-json-extract.js";
import { clipIdempotencyKey } from "../src/ai/ceo-plan-prompt.js";
import { CEO_PLAN_OLLAMA_FORMAT } from "../src/ai/ceo-plan-json-schema.js";
import { decidePersistableTasks } from "../src/ai/portfolio-eval.js";
import { reassignCeoTaskRole } from "../src/ai/plan-role-gate.js";
import {
  LocalModelProvider,
  normalizeLocalCeoPlanJson,
  readOllamaGenerateStream,
  resetLocalProviderInFlightForTests,
  setLocalProviderFetchForTests,
} from "../src/ai/providers/local-provider.js";

afterEach(() => {
  setLocalProviderFetchForTests(null);
  resetLocalProviderInFlightForTests();
});

const validPlan = {
  summary: "Seçilen projeler için kısa plan",
  goalsAddressed: ["subify-quality"],
  tasks: [
    {
      title: "Subify kalite incelemesi",
      description: "Repo yapısı ve test boşlukları.",
      projectSlug: "subify",
      assigneeId: "cto",
      priority: "high",
      acceptanceCriteria: "repo_read kanıtı; uydurma defect yok.",
      evidenceHint: "goal:subify-quality",
    },
  ],
  risks: ["repo bağları eksik olabilir"],
  requiresOwnerApproval: true,
  estimatedAiCost: "local_compute",
};

function tagsOk() {
  return new Response(JSON.stringify({ models: [{ name: "qwen2.5:14b" }] }), { status: 200 });
}

describe("extractCeoPlanJson", () => {
  it("geçerli JSON", () => {
    const r = extractCeoPlanJson(JSON.stringify(validPlan));
    expect(r.kind).toBe("json");
    expect(r.jsonText).toBeTruthy();
    expect(CeoPlanSchema.parse(JSON.parse(r.jsonText!)).tasks).toHaveLength(1);
  });

  it("markdown code fence içinden JSON alır; metinden görev uydurmaz", () => {
    const r = extractCeoPlanJson("İşte plan:\n```json\n" + JSON.stringify(validPlan) + "\n```\n");
    expect(r.kind).toBe("fence");
    expect(r.hasFence).toBe(true);
    expect(JSON.parse(r.jsonText!).tasks[0].projectSlug).toBe("subify");
  });

  it("boş yanıt", () => {
    const r = extractCeoPlanJson("   ");
    expect(r.kind).toBe("empty");
    expect(r.jsonText).toBeNull();
  });

  it("kesilmiş JSON", () => {
    const r = extractCeoPlanJson('{"summary":"x","tasks":[{"title":"abc"');
    expect(r.kind).toBe("truncated");
    expect(r.jsonText).toBeNull();
  });

  it("düz metin görev uydurmaz", () => {
    const r = extractCeoPlanJson("Subify için CTO görevi aç ve marivo büyümesini hızlandır.");
    expect(r.kind).toBe("plaintext");
    expect(r.jsonText).toBeNull();
  });
});

describe("schema / grounding / persist sınıfları", () => {
  it("eksik alan schema_validation_failed", () => {
    expect(() =>
      CeoPlanSchema.parse(
        normalizeLocalCeoPlanJson({
          summary: "x",
          tasks: [{ title: "ab", projectSlug: "subify" }],
        }),
      ),
    ).toThrow();
  });

  it("yanlış projectSlug schema reddi", () => {
    expect(() =>
      CeoPlanSchema.parse({
        ...validPlan,
        tasks: [{ ...validPlan.tasks[0], projectSlug: "other-co" }],
      }),
    ).toThrow();
  });

  it("yanlış ajan ceo ise rol kapısı cto", () => {
    const r = reassignCeoTaskRole({
      ...validPlan.tasks[0],
      assigneeId: "ceo",
      title: "Operasyon değerlendirmesi",
      description: "şirket portföy özeti",
      acceptanceCriteria: "kanıtlı çıktı",
    });
    expect(r.task.assigneeId).toBe("cto");
  });

  it("duplicate title reason code", () => {
    const r = decidePersistableTasks({
      items: [
        { ok: true, task: validPlan.tasks[0] },
        { ok: true, task: { ...validPlan.tasks[0], title: "Subify kalite incelemesi" } },
      ],
      selectedSlugs: ["subify"],
      remainingSlots: 8,
      isDuplicateTitle: (title) => title.includes("Subify"),
    });
    expect(r.keep).toHaveLength(0);
    expect(r.drops.every((d) => d.reasonCode === "duplicate_open_title")).toBe(true);
  });

  it("Stage A dışı proje not_in_stage_a_selection", () => {
    const r = decidePersistableTasks({
      items: [
        {
          ok: true,
          task: { ...validPlan.tasks[0], projectSlug: "synaptech-ai-os", title: "OS tekrar" },
        },
      ],
      selectedSlugs: ["subify", "marivo", "synaptech"],
      remainingSlots: 8,
      isDuplicateTitle: () => false,
    });
    expect(r.drops[0]?.reasonCode).toBe("not_in_stage_a_selection");
  });

  it("MSSQL idempotency taşması ayrı kod", () => {
    expect(
      classifyPersistError(
        new Error("The provided value for the column is too long for the column's type. Column: idempotencyKey"),
      ),
    ).toBe("persist_idempotency_key_too_long");
    expect(classifyPersistError(new Error("connection reset"))).toBe("persist_failed");
    expect(clipIdempotencyKey(`scheduler-ai-ceo-child:ops-2026-11-18:${"a".repeat(80)}:title`).length).toBeLessThanOrEqual(128);
  });
});

describe("Ollama structured generate", () => {
  it("CEO çağrısı stream:false ve JSON schema format gönderir", async () => {
    let captured: Record<string, unknown> | null = null;
    setLocalProviderFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) return tagsOk();
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          response: JSON.stringify(validPlan),
          done: true,
          prompt_eval_count: 80,
          eval_count: 40,
        }),
        { status: 200 },
      );
    });
    const local = new LocalModelProvider("http://127.0.0.1:11434", "qwen2.5:14b");
    const completion = await local.generateCeoPlan({
      goals: [{ goalKey: "subify-quality", projectSlug: "subify", title: "kalite", dataSource: "mssql:Opportunity" }],
      opportunities: [],
      openTaskCount: 0,
    });
    expect(completion.realAiExecution).toBe(true);
    expect(captured?.stream).toBe(false);
    expect(captured?.format).toEqual(CEO_PLAN_OLLAMA_FORMAT);
    expect(completion.parsedPlan?.tasks[0]?.projectSlug).toBe("subify");
  });

  it("boş response local_llm_empty_response", async () => {
    setLocalProviderFetchForTests(async (input) => {
      if (String(input).endsWith("/api/tags")) return tagsOk();
      return new Response(JSON.stringify({ response: "", done: true }), { status: 200 });
    });
    const local = new LocalModelProvider("http://127.0.0.1:11434", "qwen2.5:14b");
    await expect(
      local.generateCeoPlan({ goals: [], opportunities: [], openTaskCount: 0 }),
    ).rejects.toThrow(/local_llm_empty_response/);
  });

  it("kesilmiş JSON local_llm_truncated_json", async () => {
    setLocalProviderFetchForTests(async (input) => {
      if (String(input).endsWith("/api/tags")) return tagsOk();
      return new Response(JSON.stringify({ response: '{"summary":"x","tasks":[', done: true }), { status: 200 });
    });
    const local = new LocalModelProvider("http://127.0.0.1:11434", "qwen2.5:14b");
    await expect(
      local.generateCeoPlan({ goals: [], opportunities: [], openTaskCount: 0 }),
    ).rejects.toThrow(/local_llm_truncated_json/);
  });

  it("eksik zorunlu alan schema_validation_failed", async () => {
    setLocalProviderFetchForTests(async (input) => {
      if (String(input).endsWith("/api/tags")) return tagsOk();
      return new Response(
        JSON.stringify({ response: JSON.stringify({ summary: "x", tasks: [] }), done: true }),
        { status: 200 },
      );
    });
    const local = new LocalModelProvider("http://127.0.0.1:11434", "qwen2.5:14b");
    await expect(
      local.generateCeoPlan({ goals: [], opportunities: [], openTaskCount: 0 }),
    ).rejects.toThrow(/schema_validation_failed/);
  });

  it("newline'siz stream son satırını düşürmez", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ response: JSON.stringify(validPlan), done: true, eval_count: 9 }),
          ),
        );
        controller.close();
      },
    });
    const parsed = await readOllamaGenerateStream(new Response(body, { status: 200 }));
    expect(JSON.parse(parsed.text).summary).toContain("kısa plan");
    expect(parsed.metrics.evalCount).toBe(9);
  });
});
