/**
 * Kontrollü otonomi zaman penceresi — MSSQL SystemSetting.
 * Restart sonrası da geçerli: süre dolduysa env kapıları off yazılır ve yürütme fail-closed.
 * Aktif pencere yokken env=local olsa bile otomasyon açılmaz.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getPrisma } from "../db/prisma.js";
import { getEnv, resetEnvCacheForTests } from "../lib/env.js";
import { writeAudit } from "./audit.js";

export const AUTONOMY_WINDOW_KEY = "controlled_autonomy_window";

export const T_P5E_008_LIMITS = {
  SCHEDULER_AI_CEO_MAX_PER_DAY: 2,
  LOCAL_AGENT_EXECUTION_MAX_PER_DAY: 8,
  LOCAL_AGENT_PER_AGENT_MAX_PER_DAY: 2,
  LOCAL_AGENT_TICK_MAX: 2,
  concurrentLocalLlmCalls: 1,
} as const;

export const AUTONOMY_OFF_ENV: Record<string, string> = {
  CONTROLLED_AUTONOMY_MODE: "off",
  SCHEDULER_AI_CEO_MODE: "off",
  LOCAL_AGENT_EXECUTION_MODE: "off",
  AGENT_REPO_TOOLS_MODE: "off",
  AGENT_SANDBOX_MODE: "off",
};

export type AutonomyWindow = {
  taskId: string;
  enabled: boolean;
  startedAt: string;
  expiresAt: string;
  closedAt: string | null;
  closeReason: string | null;
  limits: typeof T_P5E_008_LIMITS;
};

export function isAutonomyWindowExpired(window: AutonomyWindow | null, now = new Date()): boolean {
  if (!window) return true;
  if (!window.enabled) return true;
  return now.getTime() >= new Date(window.expiresAt).getTime();
}

export function isAutonomyWindowActive(window: AutonomyWindow | null, now = new Date()): boolean {
  return Boolean(window?.enabled) && !isAutonomyWindowExpired(window, now);
}

export async function readAutonomyWindow(): Promise<AutonomyWindow | null> {
  const prisma = getPrisma();
  const row = await prisma.systemSetting.findUnique({ where: { key: AUTONOMY_WINDOW_KEY } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as AutonomyWindow;
    if (!parsed.startedAt || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const AUTONOMY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function buildAutonomyWindow(input: {
  taskId: string;
  now?: Date;
  durationMs?: number;
  limits?: typeof T_P5E_008_LIMITS;
}): AutonomyWindow {
  const now = input.now ?? new Date();
  const durationMs = input.durationMs ?? AUTONOMY_WINDOW_MS;
  return {
    taskId: input.taskId,
    enabled: true,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + durationMs).toISOString(),
    closedAt: null,
    closeReason: null,
    limits: input.limits ?? T_P5E_008_LIMITS,
  };
}

/** Pencere kaydı + limit anahtarları. MODE=local yazmaz; Owner env’i ayrıca açar. */
export async function openAutonomyWindow(input: {
  taskId: string;
  durationMs?: number;
  limits?: typeof T_P5E_008_LIMITS;
}): Promise<AutonomyWindow> {
  const window = buildAutonomyWindow(input);
  await writeAutonomyWindow(window, "autonomy-window");
  persistAutonomyEnvKeys({
    SCHEDULER_AI_CEO_MAX_PER_DAY: String(window.limits.SCHEDULER_AI_CEO_MAX_PER_DAY),
    LOCAL_AGENT_EXECUTION_MAX_PER_DAY: String(window.limits.LOCAL_AGENT_EXECUTION_MAX_PER_DAY),
    LOCAL_AGENT_PER_AGENT_MAX_PER_DAY: String(window.limits.LOCAL_AGENT_PER_AGENT_MAX_PER_DAY),
    LOCAL_AGENT_TICK_MAX: String(window.limits.LOCAL_AGENT_TICK_MAX),
    CLOUD_AGENT_LIVE_ENABLED: "false",
    CURSOR_CLOUD_MODE: "mock",
  });
  await writeAudit({
    category: "autonomy",
    action: "autonomy.window_opened",
    actorKind: "system",
    summary: `Kontrollü otonomi penceresi açıldı: ${window.taskId} → ${window.expiresAt}`,
    metadata: {
      taskId: window.taskId,
      startedAt: window.startedAt,
      expiresAt: window.expiresAt,
      limits: window.limits,
      realAiExecution: false,
    },
  });
  return window;
}

export async function writeAutonomyWindow(
  window: AutonomyWindow,
  updatedBy = "system",
): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  await prisma.systemSetting.upsert({
    where: { key: AUTONOMY_WINDOW_KEY },
    create: {
      key: AUTONOMY_WINDOW_KEY,
      value: JSON.stringify(window),
      updatedBy,
    },
    update: { value: JSON.stringify(window), updatedBy, updatedAt: now },
  });
}

function rootEnvPath(): string {
  return path.resolve(process.cwd(), "../../.env");
}

/** Yalnızca otomasyon kapı anahtarları — secret yazdırılmaz. */
export function persistAutonomyEnvKeys(updates: Record<string, string>): { ok: boolean; keys: string[] } {
  if (process.env.NODE_ENV === "test" && process.env.AUTONOMY_WINDOW_ALLOW_ENV_WRITE !== "1") {
    return { ok: true, keys: [] };
  }
  const file = rootEnvPath();
  if (!existsSync(file)) return { ok: false, keys: [] };
  const allowed = new Set([
    ...Object.keys(AUTONOMY_OFF_ENV),
    "SCHEDULER_AI_CEO_MAX_PER_DAY",
    "LOCAL_AGENT_EXECUTION_MAX_PER_DAY",
    "LOCAL_AGENT_PER_AGENT_MAX_PER_DAY",
    "LOCAL_AGENT_TICK_MAX",
    "MODEL_PROVIDER",
    "LOCAL_LLM_MODEL",
    "CLOUD_AGENT_LIVE_ENABLED",
    "CURSOR_CLOUD_MODE",
  ]);
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.has(k)) safe[k] = v;
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) return line;
    const key = m[1]!;
    if (!(key in safe)) return line;
    seen.add(key);
    return `${key}=${safe[key]}`;
  });
  for (const [k, v] of Object.entries(safe)) {
    if (!seen.has(k)) next.push(`${k}=${v}`);
  }
  writeFileSync(file, `${next.join("\n").replace(/\n+$/, "\n")}`, "utf8");
  for (const [k, v] of Object.entries(safe)) process.env[k] = v;
  resetEnvCacheForTests();
  return { ok: true, keys: Object.keys(safe) };
}

export async function closeAutonomyWindow(reason: string, now = new Date()): Promise<AutonomyWindow | null> {
  const current = await readAutonomyWindow();
  const closed: AutonomyWindow = {
    taskId: current?.taskId ?? "unknown",
    enabled: false,
    startedAt: current?.startedAt ?? now.toISOString(),
    expiresAt: current?.expiresAt ?? now.toISOString(),
    closedAt: now.toISOString(),
    closeReason: reason,
    limits: current?.limits ?? T_P5E_008_LIMITS,
  };
  await writeAutonomyWindow(closed, "autonomy-window");
  persistAutonomyEnvKeys(AUTONOMY_OFF_ENV);
  await writeAudit({
    category: "autonomy",
    action: "autonomy.window_closed",
    actorKind: "system",
    summary: `Kontrollü otonomi penceresi kapatıldı: ${reason}`,
    metadata: {
      reason,
      expiresAt: closed.expiresAt,
      closedAt: closed.closedAt,
      envForcedOff: true,
      realAiExecution: false,
    },
  });
  return closed;
}

/**
 * Her tick/boot: süre dolduysa kapıları off yaz.
 * Aktif pencere yoksa local env yine fail-closed (süresiz otomasyon yok).
 */
export async function enforceAutonomyWindow(now = new Date()): Promise<{
  active: boolean;
  reason: string;
  window: AutonomyWindow | null;
  forcedOff: boolean;
}> {
  const window = await readAutonomyWindow();
  if (!window) {
    return { active: false, reason: "no_autonomy_window", window: null, forcedOff: false };
  }
  if (!window.enabled) {
    return { active: false, reason: window.closeReason ?? "window_disabled", window, forcedOff: false };
  }
  if (isAutonomyWindowExpired(window, now)) {
    await closeAutonomyWindow("window_expired_24h", now);
    return {
      active: false,
      reason: "window_expired_24h",
      window: await readAutonomyWindow(),
      forcedOff: true,
    };
  }
  return { active: true, reason: "ok", window, forcedOff: false };
}

/** Env local olsa bile pencere yok/expired ise yürütme kapalı. */
export function autonomyExecutionAllowed(
  window: AutonomyWindow | null,
  now = new Date(),
): { allowed: boolean; reason: string } {
  if (!isAutonomyWindowActive(window, now)) {
    return { allowed: false, reason: window ? "autonomy_window_expired_or_closed" : "no_autonomy_window" };
  }
  return { allowed: true, reason: "ok" };
}
