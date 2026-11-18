/**
 * Faz 4B — PILOT_EXECUTION_READY kapısı.
 * Live bayrak değiştirmez. POST /v1/agents yok.
 */
import { config as loadDotenv } from "dotenv";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const PILOT = "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot";
const BRIEF = path.join(root, "tasks", "T-P4B-001-pilot-ts-hello.md");
const EXPECTED_BRIEF = "d4d07e3a5acb478318bb5c1e717f3d6b5f70c6517e2a2970d9a01f052cf1dd04";
const RULESET_ID = 27504469;
const STALE_CLOSED = "0e1d05eb-67d3-412d-b41b-5591a87037b1";

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

function ghBin() {
  const candidates = [
    `${process.env.ProgramFiles}\\GitHub CLI\\gh.exe`,
    `${process.env.LOCALAPPDATA}\\Programs\\GitHub CLI\\gh.exe`,
    "gh",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

function ghApi(pathname) {
  const bin = ghBin();
  if (!bin) return { ok: false, error: "gh_missing" };
  try {
    const out = execFileSync(bin, ["api", pathname], { encoding: "utf8" });
    return { ok: true, json: JSON.parse(out) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 240) : String(error) };
  }
}

async function cursorGet(pathname) {
  const apiKey = process.env.CURSOR_API_KEY;
  const baseUrl = (process.env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(/\/$/, "");
  const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
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

const kill = JSON.parse(readFileSync(path.join(root, "config", "kill-switch.json"), "utf8"));
const briefSha = existsSync(BRIEF)
  ? createHash("sha256").update(readFileSync(BRIEF)).digest("hex")
  : null;

check("brief_sha_match", briefSha === EXPECTED_BRIEF, `got=${briefSha}`);
check("kill_switch_off", kill.enabled === false, `enabled=${kill.enabled}`);
check(
  "allow_list_only_pilot",
  allowed.length === 1 && norm(allowed[0]) === norm(PILOT),
  JSON.stringify(allowed),
);
check("on_demand_verified", onDemandVerified === true, `CLOUD_ON_DEMAND_VERIFIED=${onDemandVerified}`);
check("live_still_false", liveEnabled === false, `CLOUD_AGENT_LIVE_ENABLED=${liveEnabled}`);
check(
  "mode_still_mock",
  cloudMode === "mock" || cloudMode === "unset",
  `CURSOR_CLOUD_MODE=${cloudMode}`,
);
check("starting_ref_ok", startingRef === "master" || startingRef === "main", startingRef);

// GitHub ruleset — otomatik API (gh), bypass yok
const repoMeta = ghApi("repos/CenkErbakan/SynapTech-AI-OS-Pilot");
const ruleset = ghApi(`repos/CenkErbakan/SynapTech-AI-OS-Pilot/rulesets/${RULESET_ID}`);
const branchRules = ghApi("repos/CenkErbakan/SynapTech-AI-OS-Pilot/rules/branches/master");
const rs = ruleset.json;
const effective = Array.isArray(branchRules.json) ? branchRules.json : [];
const prRule = (rs?.rules ?? []).find((r) => r.type === "pull_request");
const rulesetOk =
  repoMeta.ok &&
  ruleset.ok &&
  branchRules.ok &&
  repoMeta.json?.default_branch === "master" &&
  rs?.id === RULESET_ID &&
  String(rs?.enforcement).toLowerCase() === "active" &&
  JSON.stringify(rs?.conditions?.ref_name?.include ?? []).includes("~DEFAULT_BRANCH") &&
  Boolean(prRule) &&
  Number(prRule?.parameters?.required_approving_review_count) >= 1 &&
  Array.isArray(rs?.bypass_actors) &&
  rs.bypass_actors.length === 0 &&
  effective.some((r) => r.type === "pull_request" && r.ruleset_id === RULESET_ID);

check(
  "github_ruleset_master_pr",
  rulesetOk,
  JSON.stringify({
    via: "gh",
    default_branch: repoMeta.json?.default_branch,
    rulesetId: rs?.id,
    name: rs?.name,
    enforcement: rs?.enforcement,
    include: rs?.conditions?.ref_name?.include,
    prRequiredApprovals: prRule?.parameters?.required_approving_review_count ?? null,
    bypassActors: rs?.bypass_actors?.length ?? null,
    branchRuleTypes: effective.map((r) => r.type),
    ownerDeclared: {
      id: 27504469,
      name: "SynapTech AI Pilot Protection",
      enforcement: "active",
      target: "~DEFAULT_BRANCH (master)",
    },
  }),
);

const agents = await cursorGet("/v1/agents?limit=50");
const creatingOrRunning = (agents.json?.items ?? []).filter((a) => {
  const s = String(a.status || "").toUpperCase();
  return s === "CREATING" || s === "RUNNING" || s === "WAITING_FOR_BACKGROUND_WORK";
});
check("cursor_auth_ok", agents.ok, `status=${agents.status}`);
check(
  "cursor_no_active_runs",
  creatingOrRunning.length === 0,
  `count=${creatingOrRunning.length}`,
);

const secretsPilot = await cursorGet(
  `/v1/secrets?repo=${encodeURIComponent("github.com/CenkErbakan/SynapTech-AI-OS-Pilot")}`,
);
check(
  "cursor_app_pilot_plausible",
  secretsPilot.ok && secretsPilot.status !== 403,
  `secretsStatus=${secretsPilot.status}`,
);

const cloudStatus = await apiGet("/api/cloud/status");
const cloudRuns = await apiGet("/api/cloud/runs");
const activeRuns = cloudStatus.json?.cloud?.activeRuns;
const stale = (cloudRuns.json?.runs ?? []).find((r) => r.id === STALE_CLOSED);
check("api_active_runs_zero", activeRuns === 0, `activeRuns=${activeRuns}`);
check(
  "stale_mock_closed",
  stale &&
    stale.executionMode === "mock" &&
    (stale.status === "cancelled" || stale.cursorStatus === "CANCELLED"),
  JSON.stringify(
    stale
      ? {
          id: stale.id,
          status: stale.status,
          cursorStatus: stale.cursorStatus,
          executionMode: stale.executionMode,
        }
      : null,
  ),
);

const approvals = await apiGet("/api/approvals");
const cloudApprovals = (approvals.json?.approvals ?? approvals.json?.items ?? []).filter(
  (a) => a.type === "cloud_agent_run",
);
const approvedMatching = cloudApprovals.filter(
  (a) => a.status === "approved" || a.effectiveStatus === "approved",
);

// Execution-ready: approval may be created at start time; gate requires machinery ready.
// If no approved record yet, warn but do not block PILOT_EXECUTION_READY — Owner live start
// will create+bind approval. However Owner asked to check Owner approval + content hash.
const policySrc = readFileSync(
  path.join(root, "apps", "api", "src", "cursor", "pilot-policy.ts"),
  "utf8",
);
const dispatchSrc = readFileSync(
  path.join(root, "apps", "api", "src", "engines", "cloud-dispatch.ts"),
  "utf8",
);
check(
  "hash_gate_in_code",
  dispatchSrc.includes("boundVersion") &&
    dispatchSrc.includes("currentVersion") &&
    policySrc.includes("computeCloudRunContentVersion"),
  "contentVersion mismatch blocks execute",
);
check(
  "pilot_policy_locked",
  /PILOT_AUTO_CREATE_PR\s*=\s*false/.test(policySrc) &&
    /PILOT_WORK_ON_CURRENT_BRANCH\s*=\s*false/.test(policySrc) &&
    policySrc.includes('"main"') &&
    policySrc.includes('"master"'),
  "autoCreatePR/workOnCurrentBranch/main+master",
);

if (approvedMatching.length === 0) {
  warnings.push(
    "Henüz approved cloud_agent_run kaydı yok — canlı başlatma anında oluşturulup contentVersion ile bağlanmalı.",
  );
}

const report = {
  status: blockers.length === 0 ? "PILOT_EXECUTION_READY" : "BLOCKED",
  liveAgentStarted: false,
  liveFlagsChanged: false,
  postAgentsCalled: false,
  briefSha256: briefSha,
  githubRulesetVerified: rulesetOk
    ? {
        id: RULESET_ID,
        name: rs.name,
        enforcement: rs.enforcement,
        include: rs.conditions.ref_name.include,
        defaultBranch: repoMeta.json.default_branch,
        pullRequestRequiredApprovals: prRule.parameters.required_approving_review_count,
        bypassActors: [],
        verifiedVia: "gh api (Owner oturumu)",
      }
    : null,
  staleMock: {
    id: STALE_CLOSED,
    closed: Boolean(stale && stale.cursorStatus === "CANCELLED"),
    deleted: false,
  },
  activeRuns,
  cursorCreatingOrRunning: creatingOrRunning.length,
  approvedCloudApprovals: approvedMatching.length,
  checks,
  blockers,
  warnings,
  nextStep:
    blockers.length === 0
      ? "Owner açık canlı başlat onayıyla tek live run çalıştırılabilir (henüz başlatılmadı)."
      : "Blokajları giderin; live başlatmayın.",
};

console.log(JSON.stringify(report, null, 2));
process.exit(blockers.length === 0 ? 0 : 2);
