export const OWNER_RETRY_PREFIX = "OWNER-RETRY:";

export function parseOwnerRetryRemaining(executionPolicy: string | null | undefined): number {
  const raw = executionPolicy ?? "";
  const m = raw.match(/OWNER-RETRY:(\d+)/i);
  if (!m) return 0;
  return Math.max(0, Math.min(3, Number(m[1])));
}

export function withOwnerRetryRemaining(executionPolicy: string | null | undefined, remaining: number): string {
  const n = Math.max(0, Math.min(3, remaining));
  const stripped = (executionPolicy ?? "AUTO").replace(/\s*OWNER-RETRY:\d+/gi, "").trim() || "AUTO";
  if (n <= 0) return stripped;
  return `${stripped} ${OWNER_RETRY_PREFIX}${n}`.trim();
}

export function retryBudgetExhausted(input: {
  spentProviderCalls: number;
  maxRetries: number;
  ownerRetryRemaining: number;
}): boolean {
  if (input.ownerRetryRemaining > 0) return false;
  return input.spentProviderCalls > input.maxRetries;
}
