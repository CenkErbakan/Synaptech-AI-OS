import { getPrisma } from "../db/prisma.js";

export const CEO_PROVIDER_CIRCUIT_KEY = "ceo_provider_circuit";

export type CeoProviderCircuitState = {
  failures: number;
  lastFailureAt: string | null;
  lastError: string | null;
  openUntil: string | null;
  lastSuccessAt: string | null;
};

export function nextCeoCircuitBackoffMs(failures: number): number {
  const n = Math.max(1, failures);
  return Math.min(60 * 60 * 1000, 5 * 60_000 * 2 ** Math.min(n - 1, 4));
}

export function evaluateCeoCircuit(
  state: CeoProviderCircuitState | null,
  now: Date,
): { skip: boolean; reason?: string; waitMs: number } {
  if (!state?.openUntil) return { skip: false, waitMs: 0 };
  const until = Date.parse(state.openUntil);
  if (!Number.isFinite(until)) return { skip: false, waitMs: 0 };
  const waitMs = until - now.getTime();
  if (waitMs > 0) {
    return { skip: true, reason: "ceo_provider_circuit_open", waitMs };
  }
  return { skip: false, waitMs: 0 };
}

export function emptyCircuit(): CeoProviderCircuitState {
  return {
    failures: 0,
    lastFailureAt: null,
    lastError: null,
    openUntil: null,
    lastSuccessAt: null,
  };
}

export async function readCeoProviderCircuit(): Promise<CeoProviderCircuitState> {
  const prisma = getPrisma();
  const row = await prisma.systemSetting.findUnique({ where: { key: CEO_PROVIDER_CIRCUIT_KEY } });
  if (!row?.value) return emptyCircuit();
  try {
    const parsed = JSON.parse(row.value) as CeoProviderCircuitState;
    return {
      failures: typeof parsed.failures === "number" ? parsed.failures : 0,
      lastFailureAt: parsed.lastFailureAt ?? null,
      lastError: parsed.lastError ? String(parsed.lastError).slice(0, 240) : null,
      openUntil: parsed.openUntil ?? null,
      lastSuccessAt: parsed.lastSuccessAt ?? null,
    };
  } catch {
    return emptyCircuit();
  }
}

async function writeCircuit(state: CeoProviderCircuitState): Promise<void> {
  const prisma = getPrisma();
  const value = JSON.stringify(state);
  await prisma.systemSetting.upsert({
    where: { key: CEO_PROVIDER_CIRCUIT_KEY },
    create: { key: CEO_PROVIDER_CIRCUIT_KEY, value, updatedBy: "system" },
    update: { value, updatedBy: "system" },
  });
}

export async function tripCeoProviderCircuit(error: string, now = new Date()): Promise<CeoProviderCircuitState> {
  const prev = await readCeoProviderCircuit();
  const failures = prev.failures + 1;
  const waitMs = nextCeoCircuitBackoffMs(failures);
  const next: CeoProviderCircuitState = {
    failures,
    lastFailureAt: now.toISOString(),
    lastError: error.slice(0, 240),
    openUntil: new Date(now.getTime() + waitMs).toISOString(),
    lastSuccessAt: prev.lastSuccessAt,
  };
  await writeCircuit(next);
  return next;
}

export async function resetCeoProviderCircuit(now = new Date()): Promise<CeoProviderCircuitState> {
  const next: CeoProviderCircuitState = {
    failures: 0,
    lastFailureAt: null,
    lastError: null,
    openUntil: null,
    lastSuccessAt: now.toISOString(),
  };
  await writeCircuit(next);
  return next;
}
