import { getEnv } from "../../lib/env.js";
import { integrationUnavailable } from "../../lib/errors.js";
import type { ModelProvider } from "../model-provider.js";
import { LocalModelProvider } from "./local-provider.js";
import { MockModelProvider } from "./mock-provider.js";

let cached: ModelProvider | null = null;

export function getModelProvider(): ModelProvider {
  if (cached) return cached;
  const env = getEnv();
  const mode = env.MODEL_PROVIDER;

  if (mode === "local") {
    const base =
      env.LOCAL_LLM_BASE_URL?.trim() ||
      (env.LOCAL_AI_PILOT ? "http://127.0.0.1:11434" : "");
    cached = new LocalModelProvider(base, env.LOCAL_LLM_MODEL);
    return cached;
  }

  cached = new MockModelProvider();
  return cached;
}

export function resetModelProviderForTests(): void {
  cached = null;
}

export async function resolveActiveModelProvider(): Promise<{
  provider: ModelProvider;
  mode: string;
  realAiAvailable: boolean;
  note: string;
  /** local seçili ama erişilemez — mock'a düşülmez */
  localUnavailable?: boolean;
}> {
  const env = getEnv();
  const provider = getModelProvider();
  const probe = await provider.probe();

  if (env.MODEL_PROVIDER === "local") {
    if (!probe.ok) {
      // Sessiz mock YOK — hata açıkça taşınır
      return {
        provider,
        mode: "local_unavailable",
        realAiAvailable: false,
        localUnavailable: true,
        note: probe.message,
      };
    }
    return {
      provider,
      mode: "local",
      realAiAvailable: true,
      note: probe.message,
    };
  }

  if (env.MODEL_PROVIDER === "none") {
    return {
      provider: new MockModelProvider(),
      mode: "deterministic_declared",
      realAiAvailable: false,
      note: "MODEL_PROVIDER=none — deterministik/mock; gerçek AI yok.",
    };
  }

  return {
    provider,
    mode: provider.id,
    realAiAvailable: false,
    note: probe.message,
  };
}

/** MODEL_PROVIDER=local iken bağlantı yoksa exception — mock yanıt üretilmez. */
export async function requireLocalModelProvider(): Promise<ModelProvider> {
  const env = getEnv();
  if (env.MODEL_PROVIDER !== "local") {
    throw integrationUnavailable(
      `Yerel AI CEO için MODEL_PROVIDER=local gerekli (şu an: ${env.MODEL_PROVIDER}).`,
    );
  }
  const resolved = await resolveActiveModelProvider();
  if (!resolved.realAiAvailable || resolved.localUnavailable) {
    throw integrationUnavailable(
      `Yerel LLM erişilemez; mock'a düşülmedi. ${resolved.note}`,
    );
  }
  return resolved.provider;
}
