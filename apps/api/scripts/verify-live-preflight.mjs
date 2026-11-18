/**
 * Faz 4B canlı pilot — zorunlu ön kontroller.
 * POST /v1/agents YOK. Live bayrak değiştirmez.
 */
import { config as loadDotenv } from "dotenv";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const PILOT = "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot";
const BRIEF = path.join(root, "tasks", "T-P4B-001-pilot-ts-hello.md");
const EXPECTED_BRIEF =
  "d4d07e3a5acb478318bb5c1e717f3d6b5f70c6517e2a2970d9a01f052cf1dd04";

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function norm(u) {
  return String(u)
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .replace(/^https?:\/\/(www\.)?/i, "")
    .toLowerCase();
}

function redact(s) {
  return String(s)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+\S+/gi, "Basic [REDACTED]")
    .replace(/key_[A-Za-z0-9]+/gi, "[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]");
}

async function cursorGet(pathname) {
  const apiKey = process.env.CURSOR_API_KEY;
  const baseUrl = (process.env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(/\/$/, "");
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
  return { ok: res.ok, status: res.status, code: json?.error?.code ?? null, json };
}

async function githubGet(pathname) {
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_PAT ||
    process.env.SYNAPTECH_GITHUB_TOKEN;
  if (token) {
    const res = await fetch(`https://api.github.com${pathname}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "synaptech-ai-os-preflight",
      },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { preview: redact(text).slice(0, 240) };
    }
    return { ok: res.ok, status: res.status, missingToken: false, via: "token", json };
  }

  // Token yoksa güvenlik kontrolünü bypass etme — gh CLI oturumu dene
  try {
    const { execFileSync } = await import("node:child_process");
    const ghCandidates = [
      `${process.env.ProgramFiles}\\GitHub CLI\\gh.exe`,
      `${process.env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`,
      "gh",
    ];
    let ghBin = null;
    for (const c of ghCandidates) {
      try {
        execFileSync(c, ["--version"], { stdio: "ignore" });
        ghBin = c;
        break;
      } catch {
        /* next */
      }
    }
    if (!ghBin) return { ok: false, status: 0, missingToken: true, via: "none", json: null };
    const out = execFileSync(ghBin, ["api", pathname.replace(/^\//, "")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const json = JSON.parse(out);
    return { ok: true, status: 200, missingToken: false, via: "gh", json };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      missingToken: true,
      via: "gh_failed",
      json: { error: redact(error instanceof Error ? error.message : String(error)).slice(0, 240) },
    };
  }
}

const checks = [];
const blockers = [];
const warnings = [];

function check(id, ok, detail) {
  checks.push({ id, ok, detail });
  if (!ok) blockers.push(`${id}: ${detail}`);
}

const liveEnabled = boolEnv("CLOUD_AGENT_LIVE_ENABLED", false);
const cloudMode = process.env.CURSOR_CLOUD_MODE || "unset";
const onDemandVerified = boolEnv("CLOUD_ON_DEMAND_VERIFIED", false);
const startingRef = (process.env.CLOUD_AGENT_STARTING_REF || "master").trim().toLowerCase();
const allowed = String(process.env.CLOUD_AGENT_ALLOWED_REPOS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const killPath = path.join(root, "config", "kill-switch.json");
const kill = JSON.parse(readFileSync(killPath, "utf8"));

const briefSha = existsSync(BRIEF)
  ? createHash("sha256").update(readFileSync(BRIEF)).digest("hex")
  : null;

check("brief_sha_match", briefSha === EXPECTED_BRIEF, `got=${briefSha}`);
check("kill_switch_off", kill.enabled === false, JSON.stringify({ enabled: kill.enabled }));
check(
  "allow_list_only_pilot",
  allowed.length === 1 && norm(allowed[0]) === norm(PILOT),
  JSON.stringify(allowed),
);
check("on_demand_verified_closed_claim", onDemandVerified === true, `CLOUD_ON_DEMAND_VERIFIED=${onDemandVerified}`);
check(
  "starting_ref_master_or_main",
  startingRef === "master" || startingRef === "main",
  `startingRef=${startingRef}`,
);
// Preflight sırasında live hâlâ kapalı olmalı; açma execute anında yapılır
check("live_currently_off_before_enable", liveEnabled === false, `CLOUD_AGENT_LIVE_ENABLED=${liveEnabled}`);
check(
  "mode_mock_before_enable",
  cloudMode === "mock" || cloudMode === "unset",
  `CURSOR_CLOUD_MODE=${cloudMode}`,
);
check("cursor_api_key_present", Boolean(process.env.CURSOR_API_KEY?.length >= 8), "present=boolean-only");

const agents = await cursorGet("/v1/agents?limit=20");
check("cursor_auth_agents", agents.ok, `status=${agents.status} code=${agents.code}`);

const activeCursor = (agents.json?.items ?? []).filter((a) =>
  ["CREATING", "RUNNING", "ACTIVE"].includes(String(a.status || "").toUpperCase()),
);
const creatingOrRunning = (agents.json?.items ?? []).filter((a) => {
  const s = String(a.status || "").toUpperCase();
  return s === "CREATING" || s === "RUNNING" || s.includes("RUNNING");
});
check(
  "cursor_no_active_creating_running_hint",
  creatingOrRunning.length === 0,
  `hintCount=${creatingOrRunning.length} statuses=${JSON.stringify(
    (agents.json?.items ?? []).slice(0, 5).map((a) => ({ id: a.id, status: a.status, name: a.name })),
  )}`,
);

const envPilot = await cursorGet(
  `/v1/me/agents/environments?repo=${encodeURIComponent("https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot")}`,
);
const envPilotAlt = await cursorGet(
  `/v1/environments?repo=${encodeURIComponent("https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot")}`,
);
const secretsPilot = await cursorGet(
  `/v1/secrets?repo=${encodeURIComponent("github.com/CenkErbakan/SynapTech-AI-OS-Pilot")}`,
);
const envAll = await cursorGet("/v1/environments");

const cursorAppSignals = {
  agentsListOk: agents.ok,
  environmentsAllStatus: envAll.status,
  environmentsAllCount: envAll.json?.items?.length ?? envAll.json?.environments?.length ?? null,
  environmentsAllRepos: (envAll.json?.items ?? envAll.json?.environments ?? [])
    .slice(0, 5)
    .map((e) => e.url || e.repoUrl || e.name || e.id),
  pilotEnvProbe: { status: envPilot.status, ok: envPilot.ok, code: envPilot.code },
  pilotEnvAltProbe: { status: envPilotAlt.status, ok: envPilotAlt.ok, code: envPilotAlt.code },
  secretsPilot: { status: secretsPilot.status, ok: secretsPilot.ok, code: secretsPilot.code },
};

// Cursor App erişimi: auth OK + secrets/env 403 değil ise plausible
const cursorAppPlausible =
  agents.ok &&
  (secretsPilot.ok || secretsPilot.status === 200) &&
  secretsPilot.status !== 403 &&
  secretsPilot.status !== 404;
check(
  "cursor_github_app_pilot_plausible",
  cursorAppPlausible,
  JSON.stringify(cursorAppSignals),
);

// GitHub ruleset
const repoMeta = await githubGet("/repos/CenkErbakan/SynapTech-AI-OS-Pilot");
const rulesets = await githubGet("/repos/CenkErbakan/SynapTech-AI-OS-Pilot/rulesets");
const branchRules = await githubGet("/repos/CenkErbakan/SynapTech-AI-OS-Pilot/rules/branches/master");

let rulesetOk = false;
let rulesetDetail = "";
if (repoMeta.missingToken || rulesets.missingToken) {
  rulesetOk = false;
  rulesetDetail = "GITHUB_TOKEN/GH_TOKEN yok — ruleset doğrulanamadı";
} else if (!repoMeta.ok) {
  rulesetOk = false;
  rulesetDetail = `repo meta status=${repoMeta.status}`;
} else {
  const defaultBranch = repoMeta.json?.default_branch;
  const list = Array.isArray(rulesets.json) ? rulesets.json : rulesets.json?.rulesets ?? [];
  const active = list.filter((r) => String(r.enforcement || "").toLowerCase() === "active");
  // rules/branches/master returns effective rules
  const effective = Array.isArray(branchRules.json) ? branchRules.json : [];
  const hasPrRule =
    effective.some(
      (r) =>
        r.type === "pull_request" ||
        r.rules?.some?.((x) => x.type === "pull_request") ||
        JSON.stringify(r).includes("pull_request"),
    ) ||
    active.some((r) => JSON.stringify(r).toLowerCase().includes("pull_request"));

  const coversMaster =
    effective.length > 0 ||
    active.some((r) => {
      const targets = JSON.stringify(r.conditions || r.target || r).toLowerCase();
      return targets.includes("master") || targets.includes("~default") || targets.includes("default");
    });

  rulesetOk =
    repoMeta.json?.default_branch === "master" &&
    (active.length > 0 || effective.length > 0) &&
    hasPrRule &&
    coversMaster;

  rulesetDetail = JSON.stringify({
    default_branch: defaultBranch,
    rulesetsStatus: rulesets.status,
    rulesetsCount: list.length,
    activeCount: active.length,
    activeNames: active.map((r) => r.name),
    branchRulesStatus: branchRules.status,
    branchRulesTypes: effective.map((r) => r.type),
    hasPrRule,
    coversMaster,
  });
}
check("github_ruleset_master_pr", rulesetOk, rulesetDetail);

const report = {
  status: blockers.length === 0 ? "PREFLIGHT_PASS" : "BLOCKED",
  expectedBriefSha: EXPECTED_BRIEF,
  briefSha,
  killSwitchEnabled: kill.enabled,
  allowList: allowed,
  onDemandVerifiedEnv: onDemandVerified,
  startingRef,
  liveBeforeEnable: liveEnabled,
  cloudModeBeforeEnable: cloudMode,
  cursorAppSignals,
  githubRepoDefaultBranch: repoMeta.json?.default_branch ?? null,
  checks,
  blockers,
  warnings,
  postAgentsCalled: false,
};

console.log(JSON.stringify(report, null, 2));
process.exit(blockers.length === 0 ? 0 : 2);
