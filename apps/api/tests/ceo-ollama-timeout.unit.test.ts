import { afterEach, describe, expect, it } from "vitest";

import {
  buildCeoPlanPrompt,
  clipIdempotencyKey,
  compactPlanRequest,
} from "../src/ai/ceo-plan-prompt.js";
import {
  evaluateCeoCircuit,
  nextCeoCircuitBackoffMs,
  type CeoProviderCircuitState,
} from "../src/ai/ceo-provider-circuit.js";
import { evaluateIdleSkip } from "../src/engines/local-ops-policy.js";
import { CeoPlanSchema } from "@synaptech/shared";
import { normalizeLocalCeoPlanJson } from "../src/ai/providers/local-provider.js";
import {
  LOCAL_LLM_GENERATE_TIMEOUT_MS,
  LocalModelProvider,
  metricsFromOllamaChunk,
  readOllamaGenerateStream,
  resetLocalProviderInFlightForTests,
  setLocalProviderFetchForTests,
} from "../src/ai/providers/local-provider.js";

afterEach(() => {
  setLocalProviderFetchForTests(null);
  resetLocalProviderInFlightForTests();
});

describe("CEO prompt kompakt", () => {
  it("büyük MSSQL/payload içeriğini prompt'tan keser", () => {
    const huge = "E".repeat(4000);
    const built = buildCeoPlanPrompt({
      goals: Array.from({ length: 20 }, (_, i) => ({
        goalKey: `g${i}`,
        projectSlug: "synaptech-ai-os",
        title: huge,
        dataSource: huge,
      })),
      opportunities: Array.from({ length: 20 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        title: huge,
        projectSlug: "subify",
        evidenceRef: huge,
      })),
      openTaskCount: 3,
      instruction: huge,
    });
    expect(built.promptChars).toBeLessThan(3500);
    expect(built.prompt).not.toContain(huge);
    const compact = compactPlanRequest({
      goals: [{ goalKey: "x", projectSlug: "synaptech", title: huge, dataSource: huge }],
      opportunities: [],
      openTaskCount: 0,
      instruction: huge,
    });
    expect(compact.instruction?.length).toBeLessThanOrEqual(700);
  });

  it("idempotencyKey 128 karakteri aşmaz", () => {
    const raw = `scheduler-ai-ceo-child:ops-2026-11-18:${"a".repeat(36)}:${"title-".repeat(20)}`;
    expect(raw.length).toBeGreaterThan(128);
    const clipped = clipIdempotencyKey(raw);
    expect(clipped.length).toBeLessThanOrEqual(128);
  });
});

describe("CEO JSON schema", () => {
  it("normalize sonrası geçerli plan üretir ve uzun alanları keser", () => {
    const normalized = normalizeLocalCeoPlanJson({
      summary: "x".repeat(500),
      tasks: [
        {
          title: "CTO incelemesi",
          description: "d".repeat(2000),
          projectSlug: "synaptech-ai-os",
          assigneeId: "cto",
          priority: "yüksek",
          acceptanceCriteria: "a".repeat(900),
        },
      ],
      risks: ["r"],
    });
    const plan = CeoPlanSchema.parse(normalized);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.summary.length).toBeLessThanOrEqual(240);
    expect(plan.tasks[0]?.description.length).toBeLessThanOrEqual(400);
    expect(plan.requiresOwnerApproval).toBe(true);
  });

  it("boş tasks şemayı kırar", () => {
    expect(() => CeoPlanSchema.parse({ summary: "plan", tasks: [] })).toThrow();
  });
});

describe("circuit / backoff", () => {
  it("timeout sonrası 5dk circuit açar", () => {
    expect(nextCeoCircuitBackoffMs(1)).toBe(5 * 60_000);
    expect(nextCeoCircuitBackoffMs(2)).toBe(10 * 60_000);
    const now = new Date("2026-11-18T18:00:00.000Z");
    const state: CeoProviderCircuitState = {
      failures: 2,
      lastFailureAt: now.toISOString(),
      lastError: "local_llm_timeout:180000",
      openUntil: new Date(now.getTime() + 10 * 60_000).toISOString(),
      lastSuccessAt: null,
    };
    expect(evaluateCeoCircuit(state, now).skip).toBe(true);
    expect(evaluateCeoCircuit(state, new Date(now.getTime() + 11 * 60_000)).skip).toBe(false);
  });

  it("boş plan backoff hâlâ çalışır", () => {
    const r = evaluateIdleSkip({
      openTaskCount: 0,
      childOpenCount: 0,
      queueCap: 48,
      failedOpenCount: 0,
      pendingOwnerDecisionCount: 0,
      lastCeoAt: new Date("2026-11-19T00:00:00.000Z"),
      newestAgentResultAt: null,
      minIntervalMs: 0,
      planCooldownMs: 60_000,
      lastPlanPersistedChildren: 0,
      now: new Date("2026-11-19T00:02:00.000Z"),
    });
    expect(r.reason).toBe("empty_plan_backoff");
  });
});

describe("Ollama stream / timeout / duplicate", () => {
  it("metrics NDJSON done satırından çıkar", () => {
    const m = metricsFromOllamaChunk({
      prompt_eval_count: 120,
      eval_count: 80,
      prompt_eval_duration: 2_000_000_000,
      eval_duration: 4_000_000_000,
      total_duration: 7_000_000_000,
      load_duration: 500_000_000,
    });
    expect(m.promptEvalCount).toBe(120);
    expect(m.evalCount).toBe(80);
    expect(m.promptEvalDurationMs).toBe(2000);
    expect(m.evalDurationMs).toBe(4000);
    expect(m.totalDurationMs).toBe(7000);
    expect(m.loadDurationMs).toBe(500);
  });

  it("stream tamamlanınca metin birleşir", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('{"response":"{\\"summary\\":"}\n'));
        controller.enqueue(
          enc.encode(
            '{"response":"ok","done":true,"prompt_eval_count":10,"eval_count":5,"total_duration":1000000}\n',
          ),
        );
        controller.close();
      },
    });
    const parsed = await readOllamaGenerateStream(new Response(body, { status: 200 }));
    expect(parsed.text).toContain("ok");
    expect(parsed.metrics.evalCount).toBe(5);
    expect(parsed.aborted).toBe(false);
  });

  it("AbortSignal timeout fırlatır", async () => {
    setLocalProviderFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:14b" }] }), { status: 200 });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          const t = setInterval(() => {
            try {
              controller.enqueue(enc.encode('{"response":"."}\n'));
            } catch {
              clearInterval(t);
            }
          }, 20);
          const sig = init?.signal;
          sig?.addEventListener("abort", () => {
            clearInterval(t);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      });
      return new Response(stream, { status: 200 });
    });
    const local = new LocalModelProvider("http://127.0.0.1:11434", "qwen2.5:14b");
    const orig = LOCAL_LLM_GENERATE_TIMEOUT_MS;
    expect(orig).toBe(180_000);
    await expect(
      (local as unknown as { complete: Function }).complete("hi", { json: true, timeoutMs: 80 }),
    ).rejects.toThrow(/local_llm_timeout/);
  });

  it("paralel generate'i reddeder", async () => {
    let firstStarted: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    setLocalProviderFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:14b" }] }), { status: 200 });
      }
      firstStarted();
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
      return new Response('{"response":"{}","done":true}\n', { status: 200 });
    });
    const local = new LocalModelProvider("http://127.0.0.1:11434", "qwen2.5:14b");
    const first = (local as unknown as { complete: Function }).complete("a", { timeoutMs: 500, json: true });
    await gate;
    await expect(
      (local as unknown as { complete: Function }).complete("b", { timeoutMs: 500, json: true }),
    ).rejects.toThrow(/local_llm_duplicate_in_flight/);
    await first.catch(() => undefined);
  });
});
