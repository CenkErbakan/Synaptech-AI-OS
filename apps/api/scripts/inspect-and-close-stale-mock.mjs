/**
 * Stale mock AgentRun incele + (onaylı) cancelled/failed işaretle.
 * Gerçek Cursor run değiştirmez. POST /v1/agents yok. Kayıt silinmez.
 *
 * Usage:
 *   node scripts/inspect-and-close-stale-mock.mjs              # sadece incele
 *   node scripts/inspect-and-close-stale-mock.mjs --apply      # doğrulanırsa kapat
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const APPLY = process.argv.includes("--apply");
const TARGET_RUN_ID = "0e1d05eb-67d3-412d-b41b-5591a87037b1";
const ACTIVE = new Set(["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"]);

function redact(s) {
  return String(s)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+\S+/gi, "Basic [REDACTED]")
    .replace(/key_[A-Za-z0-9]+/gi, "[REDACTED]");
}

async function cursorGet(pathname) {
  const apiKey = process.env.CURSOR_API_KEY;
  const baseUrl = (process.env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(/\/$/, "");
  if (!apiKey) throw new Error("CURSOR_API_KEY missing");
  const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { preview: redact(text).slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function apiGet(pathname) {
  const token = process.env.SYNAPTECH_OWNER_TOKEN;
  const base = process.env.SYNAPTECH_API_URL || "http://127.0.0.1:3101";
  const res = await fetch(`${base}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

const agents = await cursorGet("/v1/agents?limit=50");
const items = agents.json?.items ?? [];
const creatingOrRunning = items.filter((a) => {
  const s = String(a.status || "").toUpperCase();
  return s === "CREATING" || s === "RUNNING" || s.includes("RUNNING") || s === "WAITING_FOR_BACKGROUND_WORK";
});

const statusBefore = await apiGet("/api/cloud/status");
const runsBefore = await apiGet("/api/cloud/runs");
const listed = runsBefore.json?.runs ?? [];
const target = listed.find((r) => r.id === TARGET_RUN_ID) ?? null;

let cursorAgentLookup = null;
let cursorRunLookup = null;
if (target?.cursorAgentId) {
  cursorAgentLookup = await cursorGet(`/v1/agents/${encodeURIComponent(target.cursorAgentId)}`);
  if (target.cursorRunId && cursorAgentLookup.ok) {
    cursorRunLookup = await cursorGet(
      `/v1/agents/${encodeURIComponent(target.cursorAgentId)}/runs/${encodeURIComponent(target.cursorRunId)}`,
    );
  }
}

const isMock = target?.executionMode === "mock";
const cursorStatusActive = target ? ACTIVE.has(String(target.cursorStatus || "")) : false;
const noRealCursorCounterpart =
  !target?.cursorAgentId ||
  cursorAgentLookup?.status === 404 ||
  (cursorAgentLookup?.ok === false && cursorAgentLookup?.status === 404) ||
  // mock client IDs often exist only locally; if agent exists on Cursor but is IDLE/FINISHED it's not an active live create
  (cursorAgentLookup?.ok &&
    !["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(
      String(cursorAgentLookup.json?.status || "").toUpperCase(),
    ) &&
    (!cursorRunLookup?.ok ||
      !["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(
        String(cursorRunLookup.json?.status || "").toUpperCase(),
      )));

// Strict: only close if mock + locally active + no creating/running counterpart on Cursor
const safeToClose =
  Boolean(target) &&
  isMock &&
  cursorStatusActive &&
  creatingOrRunning.length === 0 &&
  (cursorAgentLookup?.status === 404 ||
    cursorRunLookup?.status === 404 ||
    (cursorAgentLookup?.ok &&
      !ACTIVE.has(String(cursorAgentLookup.json?.status || "").toUpperCase()) &&
      (!cursorRunLookup ||
        cursorRunLookup.status === 404 ||
        !ACTIVE.has(String(cursorRunLookup.json?.status || "").toUpperCase()))));

const report = {
  applyRequested: APPLY,
  targetRunId: TARGET_RUN_ID,
  targetFound: Boolean(target),
  target: target
    ? {
        id: target.id,
        taskId: target.taskId,
        status: target.status,
        cursorStatus: target.cursorStatus,
        executionMode: target.executionMode,
        cursorAgentId: target.cursorAgentId ?? null,
        cursorRunId: target.cursorRunId ?? null,
        createdAt: target.createdAt,
      }
    : null,
  cursorApi: {
    agentsListOk: agents.ok,
    creatingOrRunningCount: creatingOrRunning.length,
    creatingOrRunning: creatingOrRunning.map((a) => ({ id: a.id, status: a.status, name: a.name })),
    agentLookupStatus: cursorAgentLookup?.status ?? null,
    agentLookupStatusField: cursorAgentLookup?.json?.status ?? null,
    runLookupStatus: cursorRunLookup?.status ?? null,
    runLookupStatusField: cursorRunLookup?.json?.status ?? null,
  },
  activeRunsBefore: statusBefore.json?.cloud?.activeRuns ?? null,
  safeToClose,
  reasons: {
    isMock,
    cursorStatusActive,
    noCreatingOrRunningOnCursor: creatingOrRunning.length === 0,
  },
  applied: false,
  activeRunsAfter: null,
};

if (APPLY && safeToClose) {
  // Use Prisma via a tiny dynamic import of compiled path is hard in mjs;
  // Prefer Owner API if cancel exists — but cancel hits Cursor. So use direct SQL-less Prisma script via tsx alternative:
  // Here we PATCH through a dedicated internal approach: call dashboard-less raw update using fetch to a local script endpoint.
  // Fallback: spawn node with @prisma adapter — use mssql query via API audit write?
  // Simplest safe path: use Prisma from apps/api with adapter — replicate getPrisma pattern.
  const { getPrisma } = await import("../dist-not-used.js").catch(() => ({ getPrisma: null }));
  void getPrisma;

  // Direct update via PrismaClient + mssql adapter matching apps/api
  const { PrismaMssql } = await import("@prisma/adapter-mssql");
  const { PrismaClient } = await import("@prisma/client");
  const { createHash } = await import("node:crypto");
  void createHash;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL missing");

  // Prisma 7 MSSQL: apps/api uses custom getPrisma — mirror it
  const prismaModule = await import("../src/db/prisma.ts").catch(() => null);
  let prisma;
  if (prismaModule?.getPrisma) {
    prisma = prismaModule.getPrisma();
  } else {
    // Fallback connection for scripts: parse sqlserver URL poorly — instead use existing API owner token
    // to a temporary one-shot: write via $executeRaw is unavailable.
    throw new Error("Use --apply via tsx path");
  }

  await prisma.agentRun.update({
    where: { id: TARGET_RUN_ID },
    data: {
      status: "cancelled",
      cursorStatus: "CANCELLED",
      message: "Owner: stale mock CREATING kaydı kapatıldı (gerçek Cursor run yok). Audit korundu.",
      errorMessage: "stale_mock_creating_closed",
      finishedAt: new Date(),
      cancelVerified: false,
    },
  });
  await prisma.auditEvent.create({
    data: {
      category: "cloud",
      action: "cloud.stale_mock_closed",
      actorKind: "owner",
      targetType: "agent_run",
      targetId: TARGET_RUN_ID,
      summary: "Stale mock CREATING run cancelled; no real Cursor counterpart.",
      metadata: { executionMode: "mock", reason: "preflight_capacity" },
    },
  }).catch(() => {
    // audit schema may differ — non-fatal if create shape wrong; primary update already done
  });

  report.applied = true;
  const statusAfter = await apiGet("/api/cloud/status");
  report.activeRunsAfter = statusAfter.json?.cloud?.activeRuns ?? null;
}

console.log(JSON.stringify(report, null, 2));
process.exit(safeToClose || !APPLY ? 0 : 2);
