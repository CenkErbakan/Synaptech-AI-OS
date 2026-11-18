/**
 * Faz 4B — PILOT_READY kontrolü (compact).
 * Yasak: POST /v1/agents, live bayrak değiştirme, push.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const PILOT = "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot";
const FORBIDDEN = [
  "https://github.com/CenkErbakan/SynapTech",
  "https://github.com/CenkErbakan/Subify",
  "https://github.com/CenkErbakan/Marivo",
  "https://github.com/CenkErbakan/AIDrivingOs",
];

function norm(u) {
  return String(u)
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .replace(/^https?:\/\//i, "")
    .toLowerCase();
}

function boolEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function assertAllowed(repoUrl, allowed) {
  const n = norm(repoUrl);
  return allowed.some((entry) => {
    const e = norm(entry);
    return n === e || n.endsWith(e.replace(/^https?:\/\//, ""));
  });
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
    json = null;
  }
  return { ok: res.ok, status: res.status, code: json?.error?.code ?? null, json };
}

const allowed = String(process.env.CLOUD_AGENT_ALLOWED_REPOS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const liveEnabled = boolEnv("CLOUD_AGENT_LIVE_ENABLED", false);
const onDemandVerified = boolEnv("CLOUD_ON_DEMAND_VERIFIED", false);
const cloudMode = process.env.CURSOR_CLOUD_MODE || "unset";
const apiKeyPresent = Boolean(process.env.CURSOR_API_KEY && process.env.CURSOR_API_KEY.length >= 8);

const checks = [];
const blockers = [];
const warnings = [];

function check(id, ok, detail) {
  checks.push({ id, ok, detail });
  if (!ok) blockers.push(`${id}: ${detail}`);
}

check("api_key_present", apiKeyPresent, apiKeyPresent ? `length=${process.env.CURSOR_API_KEY.length}` : "missing");
check("live_disabled", liveEnabled === false, `CLOUD_AGENT_LIVE_ENABLED=${liveEnabled}`);
check(
  "cloud_mode_mock",
  cloudMode === "mock" || cloudMode === "unset",
  `CURSOR_CLOUD_MODE=${cloudMode}`,
);
check("on_demand_verified_env", onDemandVerified === true, `CLOUD_ON_DEMAND_VERIFIED=${onDemandVerified}`);
check("allow_list_nonempty", allowed.length > 0, `count=${allowed.length}`);
check(
  "allow_list_only_pilot",
  allowed.length > 0 &&
    allowed.every((u) => norm(u).includes("synaptech-ai-os-pilot")) &&
    !allowed.some((u) => {
      const n = norm(u);
      return (n.includes("/synaptech") || n.endsWith("synaptech")) && !n.includes("synaptech-ai-os-pilot");
    }),
  `entries=${JSON.stringify(allowed.map((u) => u.replace(/\.git$/i, "")))}`,
);
check("allow_list_includes_pilot", assertAllowed(PILOT, allowed), PILOT);

const accessMatrix = [
  { repo: PILOT, expect: true },
  ...FORBIDDEN.map((repo) => ({ repo, expect: false })),
].map(({ repo, expect }) => {
  const got = assertAllowed(repo, allowed);
  return { repo, expect, got, pass: got === expect };
});
check(
  "allow_deny_matrix",
  accessMatrix.every((r) => r.pass),
  JSON.stringify(accessMatrix.map((r) => ({ repo: r.repo.split("/").pop(), expect: r.expect, got: r.got }))),
);

let auth = null;
let envsAll = null;
let envPilot = null;
let envSynaptech = null;
let secretsPilot = null;
let envDetail = null;

if (apiKeyPresent) {
  auth = await cursorGet("/v1/agents?limit=3");
  check("cursor_auth_get_agents", auth.ok, `HTTP ${auth.status}`);

  envsAll = await cursorGet("/v1/environments?limit=50");
  check("cursor_list_environments", envsAll.ok, `HTTP ${envsAll.status}`);

  const envItems = envsAll.json?.items ?? [];
  const envRepos = [
    ...new Set(envItems.flatMap((e) => (e.repos ?? []).map((r) => r.url)).filter(Boolean)),
  ];
  const hasPilotEnv = envRepos.some((u) => norm(u).includes("synaptech-ai-os-pilot"));
  const hasSynaptechEnv = envRepos.some(
    (u) => norm(u).includes("cenkerbakan/synaptech") && !norm(u).includes("synaptech-ai-os-pilot"),
  );

  envPilot = await cursorGet(
    `/v1/environments?repo=${encodeURIComponent("github.com/CenkErbakan/SynapTech-AI-OS-Pilot")}&limit=20`,
  );
  envSynaptech = await cursorGet(
    `/v1/environments?repo=${encodeURIComponent("github.com/CenkErbakan/SynapTech")}&limit=20`,
  );
  secretsPilot = await cursorGet(
    `/v1/secrets?repo=${encodeURIComponent("github.com/CenkErbakan/SynapTech-AI-OS-Pilot")}&limit=20`,
  );

  const synaptechEnv = envItems.find((e) =>
    (e.repos ?? []).some((r) => norm(r.url).includes("cenkerbakan/synaptech") && !norm(r.url).includes("pilot")),
  );
  if (synaptechEnv?.id) {
    envDetail = await cursorGet(`/v1/environments/${synaptechEnv.id}`);
  }

  const agentRepos = (auth.json?.items ?? []).flatMap((a) => (a.repos ?? []).map((r) => r.url));

  const historicalAssessment = {
    synaptechEnvironmentStillListed: hasSynaptechEnv,
    synaptechEnvironmentId: synaptechEnv?.id ?? null,
    synaptechEnvironmentGetOk: envDetail?.ok ?? null,
    pilotNamedEnvironmentCount: envPilot.json?.items?.length ?? null,
    synaptechFilterCount: envSynaptech.json?.items?.length ?? null,
    secretsPilotListOk: secretsPilot?.ok ?? false,
    historicalAgentReposSample: [...new Set(agentRepos)].slice(0, 5),
    interpretation: hasSynaptechEnv
      ? "Cursor hâlâ SynapTech adlı saved environment kaydı tutuyor. Bu, GitHub App'in şu an o repoya yazabileceğini kanıtlamaz; çoğu zaman eski dashboard kaydıdır. Aktif App scope Owner UI + (yalnızca onaylı) create ile kesinleşir."
      : "SynapTech environment listede yok — App daraltması / temizlik ile uyumlu.",
  };

  if (hasPilotEnv) {
    checks.push({ id: "pilot_env_listed", ok: true, detail: "pilot appears in environments" });
  } else {
    warnings.push("Pilot için named environment yok (yeni repo için normal).");
  }
  if (hasSynaptechEnv) {
    warnings.push("SynapTech environment kaydı hâlâ listeleniyor — tarihsel/kayıt; aktif erişim kanıtı değil.");
  }
  if (secretsPilot?.ok) {
    checks.push({ id: "secrets_repo_filter_ok", ok: true, detail: `HTTP ${secretsPilot.status}` });
  }

  // Compact report object (no full model dumps)
  var cursorReadonly = {
    authOk: auth.ok,
    environmentsCount: envItems.length,
    environmentRepos: envRepos,
    pilotFilterCount: envPilot.json?.items?.length ?? null,
    synaptechFilterCount: envSynaptech.json?.items?.length ?? null,
    secretsPilotOk: secretsPilot?.ok ?? false,
    historicalAssessment,
    postAgentsCalled: false,
  };
} else {
  var cursorReadonly = { authOk: false, postAgentsCalled: false };
}

const taskPath = path.join(root, "tasks/T-P4B-001-pilot-ts-hello.md");
let taskHash = null;
try {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(taskPath, "utf8");
  taskHash = createHash("sha256").update(raw, "utf8").digest("hex");
  check("task_brief_exists", true, `T-P4B-001 sha256=${taskHash.slice(0, 16)}…`);
} catch {
  check("task_brief_exists", false, "tasks/T-P4B-001-pilot-ts-hello.md missing");
}

const pilotReady =
  blockers.length === 0 &&
  liveEnabled === false &&
  onDemandVerified === true &&
  assertAllowed(PILOT, allowed) &&
  auth?.ok;

const report = {
  phase: "4B-PILOT_READY-check",
  timestamp: new Date().toISOString(),
  status: pilotReady ? "PILOT_READY" : "NOT_READY",
  flags: {
    CLOUD_AGENT_LIVE_ENABLED: liveEnabled,
    CURSOR_CLOUD_MODE: cloudMode,
    CLOUD_ON_DEMAND_VERIFIED: onDemandVerified,
    apiKeyPresent,
  },
  allowList: allowed.map((u) => u.replace(/\.git$/i, "")),
  accessMatrix,
  checks,
  warnings,
  blockers,
  cursorReadonly,
  task: {
    id: "T-P4B-001",
    path: "tasks/T-P4B-001-pilot-ts-hello.md",
    contentSha256: taskHash,
  },
  nextRequiresOwner: pilotReady
    ? "Açık metin onayı: 'Faz 4B tek live Cloud Agent run başlat' — sonra geçici live bayrak + execute"
    : "Blokları giderin; live run yok",
};

console.log(JSON.stringify(report, null, 2));
process.exit(pilotReady ? 0 : 1);
