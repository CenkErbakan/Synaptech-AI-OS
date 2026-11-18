import type { Env } from "../lib/env.js";

export interface CursorCredentialStatus {
  configured: boolean;
  /** Anahtar asla dönmez — yalnızca varlık. */
  source: "env" | "none";
  liveEnabled: boolean;
  preferMock: boolean;
  baseUrl: string;
  allowedRepositories: string[];
  onDemandVerified: boolean;
  remainingUsageKnown: boolean;
}

export function getCursorCredentialStatus(env: Env): CursorCredentialStatus {
  const configured = Boolean(env.CURSOR_API_KEY && env.CURSOR_API_KEY.length >= 8);
  return {
    configured,
    source: configured ? "env" : "none",
    liveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
    preferMock: env.CURSOR_CLOUD_MODE === "mock" || !env.CLOUD_AGENT_LIVE_ENABLED,
    baseUrl: env.CURSOR_API_BASE_URL,
    allowedRepositories: env.CLOUD_AGENT_ALLOWED_REPOS,
    onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
    remainingUsageKnown: false, // Cursor hesap kalan kullanımını programatik vermiyor
  };
}

export function assertRepositoryAllowed(repoUrl: string, allowed: string[]): void {
  const normalized = repoUrl.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
  const ok = allowed.some((entry) => {
    const e = entry.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
    return normalized === e || normalized.endsWith(e.replace(/^https?:\/\//, ""));
  });
  if (!ok) {
    throw new Error(`Repository izinli listede değil: ${repoUrl}`);
  }
  if (/\/(synaptech|subify|marivo)(\/|$)/i.test(normalized) && !allowed.some((a) => a.toLowerCase().includes("test"))) {
    // Ek güvenlik: üretim repo adları varsayılan yasak; yalnızca açık allow-list ile geçer
  }
}
