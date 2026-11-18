/**
 * Faz 4B — canlı run öncesi son kapı kontrolü.
 * Yasak: POST /v1/agents, live bayrak değiştirme, push, merge, deploy.
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
const POLICY = path.join(root, "apps", "api", "src", "cursor", "pilot-policy.ts");
const ADAPTER = path.join(root, "apps", "api", "src", "cursor", "adapter.ts");
const DISPATCH = path.join(root, "apps", "api", "src", "engines", "cloud-dispatch.ts");

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function computeCloudRunContentVersion(input) {
  const startingRef = input.startingRef.trim().toLowerCase();
  const canonical = [
    input.title.trim(),
    input.description.trim(),
    input.repositoryUrl.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase(),
    `startingRef=${startingRef}`,
    `autoCreatePR=false`,
    `workOnCurrentBranch=false`,
    `protectedBases=main,master`,
    `allowedBranchPrefixes=cursor/,agent/`,
    `briefSha256=${input.briefSha256 ?? "none"}`,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
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
const startingRef = (process.env.CLOUD_AGENT_STARTING_REF || "master").trim().toLowerCase();
const allowed = String(process.env.CLOUD_AGENT_ALLOWED_REPOS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

check("live_still_disabled", liveEnabled === false, `CLOUD_AGENT_LIVE_ENABLED=${liveEnabled}`);
check(
  "cloud_mode_not_live_create",
  cloudMode === "mock" || cloudMode === "unset",
  `CURSOR_CLOUD_MODE=${cloudMode}`,
);
check(
  "starting_ref_protected_base",
  startingRef === "main" || startingRef === "master",
  `CLOUD_AGENT_STARTING_REF=${startingRef}`,
);
check("brief_exists", existsSync(BRIEF), BRIEF);
check("policy_module_exists", existsSync(POLICY), POLICY);

const briefSha = existsSync(BRIEF) ? sha256File(BRIEF) : null;
check("brief_sha_computed", Boolean(briefSha), briefSha ?? "missing");

const policySrc = existsSync(POLICY) ? readFileSync(POLICY, "utf8") : "";
check("policy_protects_main", policySrc.includes('"main"'), "PROTECTED_BASE_REFS main");
check("policy_protects_master", policySrc.includes('"master"'), "PROTECTED_BASE_REFS master");
check("policy_auto_pr_false", /PILOT_AUTO_CREATE_PR\s*=\s*false/.test(policySrc), "autoCreatePR");
check(
  "policy_work_current_false",
  /PILOT_WORK_ON_CURRENT_BRANCH\s*=\s*false/.test(policySrc),
  "workOnCurrentBranch",
);
check("policy_cursor_prefix", policySrc.includes("cursor/"), "cursor/");
check("policy_agent_prefix", policySrc.includes("agent/"), "agent/");

const adapterSrc = existsSync(ADAPTER) ? readFileSync(ADAPTER, "utf8") : "";
check(
  "adapter_uses_pilot_policy",
  adapterSrc.includes("assertPilotCreateOptions") && adapterSrc.includes("PILOT_AUTO_CREATE_PR"),
  "adapter pilot-policy wiring",
);

const dispatchSrc = existsSync(DISPATCH) ? readFileSync(DISPATCH, "utf8") : "";
check(
  "dispatch_blocks_version_mismatch",
  dispatchSrc.includes("boundVersion") &&
    dispatchSrc.includes("currentVersion") &&
    /uyuşmuyor|değişmiş|engellendi/i.test(dispatchSrc),
  "hash mismatch gate",
);
check(
  "dispatch_reads_brief_sha",
  dispatchSrc.includes("T-P4B-001-pilot-ts-hello.md") && dispatchSrc.includes("readPilotBriefSha256"),
  "brief hash binding",
);

const sampleVersion = briefSha
  ? computeCloudRunContentVersion({
      title: "Pilot — tek satır TypeScript yardımcısı",
      description: "placeholder-for-report-only",
      repositoryUrl: PILOT,
      startingRef,
      briefSha256: briefSha,
    })
  : null;

if (allowed.length === 0) {
  warnings.push("CLOUD_AGENT_ALLOWED_REPOS boş — execute öncesi dolu olmalı.");
}
if (startingRef !== "master") {
  warnings.push(
    `Pilot repo varsayılan branch master; şu an CLOUD_AGENT_STARTING_REF=${startingRef}. Owner master tercihini doğrulasın.`,
  );
}

const report = {
  status: blockers.length === 0 ? "FINAL_GATE_PASS" : "FINAL_GATE_BLOCKED",
  liveAgentStarted: false,
  liveFlagsChanged: false,
  autoCreatePR: false,
  workOnCurrentBranch: false,
  protectedBaseRefs: ["main", "master"],
  allowedBranchPrefixes: ["cursor/", "agent/"],
  startingRef,
  briefPath: "tasks/T-P4B-001-pilot-ts-hello.md",
  briefSha256: briefSha,
  sampleContentVersionNote:
    "Gerçek contentVersion görev title+description + repo + politika + briefSha ile hesaplanır; Owner boundVersion birebir eşleşmeli.",
  sampleContentVersionWithPlaceholderDescription: sampleVersion,
  checks,
  blockers,
  warnings,
  nextStep:
    "Açık Owner onayı bekleniyor. Canlı run için ayrı ifade gerekir (ör. 'Faz 4B tek live Cloud Agent run başlat').",
};

console.log(JSON.stringify(report, null, 2));
process.exit(blockers.length === 0 ? 0 : 1);
