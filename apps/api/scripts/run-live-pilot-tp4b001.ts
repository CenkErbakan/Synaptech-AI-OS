/**
 * Faz 4B — T-P4B-001 TEK canlı Cloud Agent orkestrasyonu.
 * Owner açık onayı ile. İkinci POST yok. Create sonrası live kapı kapanır; izleme devam eder.
 */
import { config as loadDotenv } from "dotenv";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(root, ".env");
loadDotenv({ path: envPath });

const PILOT = "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot";
const BRIEF = path.join(root, "tasks", "T-P4B-001-pilot-ts-hello.md");
const EXPECTED_BRIEF = "d4d07e3a5acb478318bb5c1e717f3d6b5f70c6517e2a2970d9a01f052cf1dd04";
const RULESET_ID = 27504469;
const TITLE = "T-P4B-001 Pilot: greet(name) TypeScript yardımcısı";
const DESCRIPTION = [
  "İzole pilot deposunda minimal TypeScript yardımcısı ekle.",
  "1) src/hello.ts: export function greet(name: string): string → \"Hello, <name>!\" (trim; boşsa \"Hello!\")",
  "2) src/hello.test.ts veya eşdeğer birim testi yaz ve çalıştır.",
  "3) Yalnızca cursor/ veya agent/ branch'te çalış; main/master'a yazma, merge/deploy/PR otomatik açma yok.",
  "4) SynapTech/Subify/Marivo koduna dokunma. Sonuç özetini raporla.",
].join("\n");

function boolEnv(name: string, def = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function setEnvFlags(liveEnabled: boolean, mode: "mock" | "live") {
  let text = readFileSync(envPath, "utf8");
  const upsert = (key: string, value: string) => {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
  };
  upsert("CLOUD_AGENT_LIVE_ENABLED", liveEnabled ? "true" : "false");
  upsert("CURSOR_CLOUD_MODE", mode);
  if (!/^CLOUD_AGENT_STARTING_REF=/m.test(text)) upsert("CLOUD_AGENT_STARTING_REF", "master");
  writeFileSync(envPath, text, "utf8");
  process.env.CLOUD_AGENT_LIVE_ENABLED = liveEnabled ? "true" : "false";
  process.env.CURSOR_CLOUD_MODE = mode;
  process.env.CLOUD_AGENT_STARTING_REF = process.env.CLOUD_AGENT_STARTING_REF || "master";
}

function ghBin() {
  for (const c of [
    `${process.env.ProgramFiles}\\GitHub CLI\\gh.exe`,
    `${process.env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`,
    "gh",
  ]) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

function ghApi(pathname: string) {
  const bin = ghBin();
  if (!bin) throw new Error("gh yok");
  return JSON.parse(execFileSync(bin, ["api", pathname], { encoding: "utf8" }));
}

async function cursorGet(pathname: string) {
  const apiKey = process.env.CURSOR_API_KEY!;
  const baseUrl = (process.env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(/\/$/, "");
  const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

const report: Record<string, unknown> = {
  status: "pending",
  liveAgentStarted: false,
  postCount: 0,
  ambiguousNoRetry: true,
};

try {
  // ——— 1) Preflight ———
  const briefSha = createHash("sha256").update(readFileSync(BRIEF)).digest("hex");
  if (briefSha !== EXPECTED_BRIEF) throw new Error(`Brief SHA uyuşmazlığı: ${briefSha}`);

  const kill = JSON.parse(readFileSync(path.join(root, "config", "kill-switch.json"), "utf8"));
  if (kill.enabled) throw new Error("Kill switch açık");

  const allowed = String(process.env.CLOUD_AGENT_ALLOWED_REPOS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length !== 1 || !allowed[0].toLowerCase().includes("synaptech-ai-os-pilot")) {
    throw new Error(`Allow-list geçersiz: ${JSON.stringify(allowed)}`);
  }
  if (!boolEnv("CLOUD_ON_DEMAND_VERIFIED", false)) throw new Error("CLOUD_ON_DEMAND_VERIFIED false");
  if (boolEnv("CLOUD_AGENT_LIVE_ENABLED", false)) throw new Error("Live önceden açık olmamalı");
  if ((process.env.CURSOR_CLOUD_MODE || "mock") !== "mock") throw new Error("Mode mock olmalı");

  const ruleset = ghApi(`repos/CenkErbakan/SynapTech-AI-OS-Pilot/rulesets/${RULESET_ID}`);
  if (ruleset.enforcement !== "active" || ruleset.id !== RULESET_ID) {
    throw new Error("Ruleset aktif değil");
  }
  const repo = ghApi("repos/CenkErbakan/SynapTech-AI-OS-Pilot");
  if (repo.default_branch !== "master") throw new Error(`default_branch=${repo.default_branch}`);

  const agentsList = await cursorGet("/v1/agents?limit=50");
  if (!agentsList.ok) throw new Error("Cursor auth başarısız");
  const busy = (agentsList.json?.items ?? []).filter((a: { status?: string }) =>
    ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(String(a.status || "").toUpperCase()),
  );
  if (busy.length) throw new Error(`Cursor aktif run var: ${busy.length}`);

  // ——— modules (env still mock) ———
  process.env.CLOUD_AGENT_STARTING_REF = process.env.CLOUD_AGENT_STARTING_REF || "master";
  const { resetEnvCacheForTests, getEnv } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  getEnv();

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { createRealTask } = await import("../src/engines/task-engine.js");
  const { prepareCloudExecutionGate, executeApprovedCloudRun, syncCloudRun, countActiveCloudRuns } =
    await import("../src/engines/cloud-dispatch.js");
  const { decideRealApproval } = await import("../src/engines/approval-engine.js");
  const { resetCursorCloudAdapterForTests, getCursorCloudAdapter } = await import("../src/cursor/adapter.js");
  const { LiveCursorCloudClient } = await import("../src/cursor/live-client.js");
  const { writeAudit } = await import("../src/engines/audit.js");

  const prisma = getPrisma();
  const activeBefore = await countActiveCloudRuns();
  if (activeBefore !== 0) throw new Error(`activeRuns=${activeBefore} (0 olmalı)`);

  const ownerActor = { kind: "user" as const };

  const task = await createRealTask(
    {
      title: TITLE,
      description: DESCRIPTION,
      projectSlug: "synaptech",
      assignee: "developer",
      priority: "medium",
      initialStatus: "planned",
      idempotencyKey: `tp4b001-live-${EXPECTED_BRIEF.slice(0, 16)}`,
    },
    ownerActor,
  );

  const gate = await prepareCloudExecutionGate(task.id);
  report.taskId = task.id;
  report.approvalId = gate.approvalId;
  report.contentVersion = gate.contentVersion;

  const decided = await decideRealApproval(
    gate.approvalId,
    "approved",
    ownerActor,
    "Owner Faz 4B tek canlı pilot onayı — T-P4B-001 only.",
  );
  report.boundVersion = decided.decision?.boundVersion ?? null;
  if (decided.decision?.boundVersion !== gate.contentVersion) {
    throw new Error(
      `boundVersion uyuşmazlığı: bound=${decided.decision?.boundVersion} content=${gate.contentVersion}`,
    );
  }

  // ——— 3) Live enable (yalnızca bu create) ———
  setEnvFlags(true, "live");
  resetEnvCacheForTests();
  resetCursorCloudAdapterForTests();
  getEnv();
  // Force live client
  const liveClient = new LiveCursorCloudClient({
    apiKey: process.env.CURSOR_API_KEY!,
    baseUrl: process.env.CURSOR_API_BASE_URL,
    liveCreateEnabled: true,
  });
  getCursorCloudAdapter().useClient(liveClient);

  let createResult: Awaited<ReturnType<typeof executeApprovedCloudRun>>;
  try {
    report.postCount = 1;
    createResult = await executeApprovedCloudRun({
      taskId: task.id,
      approvalId: gate.approvalId,
      repositoryUrl: PILOT,
      actorKind: "owner",
    });
  } catch (error) {
    // Belirsiz olabilir — ikinci POST YOK; Cursor listesinde ara
    const errMsg = error instanceof Error ? error.message : String(error);
    report.createError = errMsg;
    const listed = await cursorGet("/v1/agents?limit=20");
    const maybe = (listed.json?.items ?? []).find(
      (a: { id?: string; name?: string }) =>
        String(a.id || "").includes(task.id) || String(a.name || "").includes("T-P4B-001"),
    );
    report.ambiguousLookup = maybe ? { id: maybe.id, status: maybe.status, name: maybe.name } : null;
    throw error;
  }

  report.liveAgentStarted = Boolean(createResult.ok && createResult.cursorAgentId);
  report.cursorAgentId = createResult.cursorAgentId ?? null;
  report.cursorRunId = createResult.cursorRunId ?? null;
  report.createMessage = createResult.message;
  report.createMode = createResult.mode;
  report.dispatchState = createResult.dispatchState;

  await writeAudit({
    category: "cloud",
    action: createResult.ok ? "cloud.live_pilot_started" : "cloud.live_pilot_start_failed",
    actorKind: "owner",
    targetType: "task",
    targetId: task.id,
    summary: createResult.message,
    metadata: {
      cursorAgentId: createResult.cursorAgentId,
      cursorRunId: createResult.cursorRunId,
      mode: createResult.mode,
      approvalId: gate.approvalId,
      contentVersion: gate.contentVersion,
    },
  });

  // ——— 7) Live kapıyı hemen kapat (izleme devam) ———
  setEnvFlags(false, "mock");
  resetEnvCacheForTests();
  // Create kilidi kapalı live client — GET izleme için
  const watchClient = new LiveCursorCloudClient({
    apiKey: process.env.CURSOR_API_KEY!,
    baseUrl: process.env.CURSOR_API_BASE_URL,
    liveCreateEnabled: false,
  });
  resetCursorCloudAdapterForTests();
  getEnv();
  getCursorCloudAdapter().useClient(watchClient);

  report.liveFlagsAfterCreate = {
    CLOUD_AGENT_LIVE_ENABLED: process.env.CLOUD_AGENT_LIVE_ENABLED,
    CURSOR_CLOUD_MODE: process.env.CURSOR_CLOUD_MODE,
  };

  if (!createResult.ok || !createResult.cursorAgentId || !createResult.cursorRunId) {
    report.status = "START_FAILED";
    console.log(JSON.stringify(report, null, 2));
    await disconnectPrisma();
    process.exit(2);
  }

  // ——— 8) İzleme ———
  const terminal = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);
  const polls: Array<Record<string, unknown>> = [];
  const started = Date.now();
  const maxMs = 15 * 60 * 1000;
  let lastStatus = "CREATING";
  let lastRun: Record<string, unknown> | null = null;

  while (Date.now() - started < maxMs) {
    try {
      const sync = await syncCloudRun(task.id);
      const run = await watchClient.getRun(createResult.cursorAgentId, createResult.cursorRunId);
      lastStatus = run.status;
      lastRun = run as unknown as Record<string, unknown>;
      let usage = null;
      try {
        usage = await watchClient.getUsage(createResult.cursorAgentId, createResult.cursorRunId);
      } catch {
        usage = null;
      }
      if (usage?.totalUsage?.totalTokens != null) {
        await prisma.agentRun.updateMany({
          where: { cursorRunId: createResult.cursorRunId },
          data: { totalTokens: usage.totalUsage.totalTokens },
        });
      }
      polls.push({
        at: new Date().toISOString(),
        cursorStatus: run.status,
        dispatchState: sync.dispatchState,
        branch: run.git?.branches?.[0]?.branch ?? null,
        hasResult: Boolean(run.result),
        totalTokens: usage?.totalUsage?.totalTokens ?? null,
      });
      if (terminal.has(run.status)) break;
    } catch (error) {
      polls.push({
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  report.polls = polls;
  report.finalCursorStatus = lastStatus;
  report.finalResult = typeof lastRun?.result === "string" ? String(lastRun.result).slice(0, 4000) : null;
  report.git = lastRun?.git ?? null;

  const branchName =
    (lastRun?.git as { branches?: Array<{ branch?: string }> } | undefined)?.branches?.[0]?.branch ?? null;
  report.githubBranch = branchName;

  // GitHub branch doğrulama
  if (branchName) {
    try {
      const ref = ghApi(
        `repos/CenkErbakan/SynapTech-AI-OS-Pilot/branches/${encodeURIComponent(branchName)}`,
      );
      report.githubBranchExists = Boolean(ref?.name);
      report.githubBranchProtectedBase = /^(main|master)$/i.test(branchName);
      report.githubBranchAllowedPrefix = /^(cursor\/|agent\/)/i.test(branchName);
      // Dosya listesi (tree)
      try {
        const tree = ghApi(
          `repos/CenkErbakan/SynapTech-AI-OS-Pilot/git/trees/${ref.commit.sha}?recursive=1`,
        );
        const paths = (tree.tree ?? [])
          .filter((t: { type?: string }) => t.type === "blob")
          .map((t: { path?: string }) => t.path)
          .filter(Boolean);
        report.githubFiles = paths.filter(
          (p: string) => /hello/i.test(p) || /\.test\./i.test(p) || p.startsWith("src/"),
        );
      } catch (e) {
        report.githubFilesError = e instanceof Error ? e.message : String(e);
      }
    } catch (e) {
      report.githubBranchError = e instanceof Error ? e.message : String(e);
    }
  }

  const dbRun = await prisma.agentRun.findFirst({
    where: { cursorRunId: createResult.cursorRunId },
    orderBy: { createdAt: "desc" },
  });
  const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
  report.db = {
    runStatus: dbRun?.status,
    cursorStatus: dbRun?.cursorStatus,
    executionMode: dbRun?.executionMode,
    branch: dbRun?.branch,
    totalTokens: dbRun?.totalTokens,
    resultSummary: dbRun?.resultSummary?.slice(0, 2000) ?? null,
    taskStatus: dbTask?.status,
    dispatchState: dbTask?.dispatchState,
  };

  // Final env verify
  const envNow = readFileSync(envPath, "utf8");
  const liveLine = envNow.match(/^CLOUD_AGENT_LIVE_ENABLED=(.*)$/m)?.[1];
  const modeLine = envNow.match(/^CURSOR_CLOUD_MODE=(.*)$/m)?.[1];
  report.finalEnv = { CLOUD_AGENT_LIVE_ENABLED: liveLine, CURSOR_CLOUD_MODE: modeLine };
  report.liveCreateStillDisabled = liveLine === "false" && modeLine === "mock";

  const successish = lastStatus === "FINISHED" && report.liveCreateStillDisabled;
  report.status = successish
    ? "LIVE_PILOT_FINISHED"
    : lastStatus === "ERROR" || lastStatus === "CANCELLED" || lastStatus === "EXPIRED"
      ? "LIVE_PILOT_FAILED"
      : "LIVE_PILOT_INCOMPLETE";

  // FINISHED ≠ otomatik görev başarısı
  report.taskSuccessClaim = false;
  report.note =
    "FINISHED tek başına görev başarısı değildir; dosya/test/branch kanıtı ayrıca değerlendirilir.";

  console.log(JSON.stringify(report, null, 2));
  await disconnectPrisma();
  process.exit(report.liveAgentStarted ? 0 : 2);
} catch (error) {
  report.status = "BLOCKED_OR_ERROR";
  report.error = error instanceof Error ? error.message : String(error);
  // Ensure live flags closed
  try {
    if (existsSync(envPath)) setEnvFlags(false, "mock");
  } catch {
    /* ignore */
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}
