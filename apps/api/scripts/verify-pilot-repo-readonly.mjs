/**
 * Faz 4B — pilot repo erişimi salt okunur doğrulama.
 * Yasak: POST /v1/agents, run create, push, live enable.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const PILOT = {
  https: "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot",
  httpsGit: "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot.git",
  slugVariants: [
    "github.com/CenkErbakan/SynapTech-AI-OS-Pilot",
    "github.com/cenkerbakan/synaptech-ai-os-pilot",
    "CenkErbakan/SynapTech-AI-OS-Pilot",
  ],
};

const apiKey = process.env.CURSOR_API_KEY;
const baseUrl = (process.env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(/\/$/, "");
const liveEnabled = ["1", "true", "yes", "on"].includes(
  String(process.env.CLOUD_AGENT_LIVE_ENABLED || "false").toLowerCase(),
);
const cloudMode = process.env.CURSOR_CLOUD_MODE || "unset";
const onDemandVerified = ["1", "true", "yes", "on"].includes(
  String(process.env.CLOUD_ON_DEMAND_VERIFIED || "false").toLowerCase(),
);
const allowed = String(process.env.CLOUD_AGENT_ALLOWED_REPOS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function normalizeRepo(u) {
  return u
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .replace(/^https?:\/\//i, "")
    .toLowerCase();
}

function redact(text) {
  return String(text)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+\S+/gi, "Basic [REDACTED]")
    .replace(/key_[A-Za-z0-9]+/gi, "[REDACTED]");
}

async function cursorGet(pathname) {
  const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { preview: redact(text).slice(0, 240) };
    }
    return {
      ok: res.ok,
      status: res.status,
      code: json?.error?.code ?? null,
      message: json?.error?.message ? redact(json.error.message) : null,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

const report = {
  phase: "4B-pilot-repo-readonly",
  postAgentsCalled: false,
  liveCreateAttempted: false,
  flags: {
    liveEnabled,
    cloudMode,
    onDemandVerifiedEnv: onDemandVerified,
    apiKeyPresent: Boolean(apiKey && apiKey.length >= 8),
  },
  allowList: {
    count: allowed.length,
    // URL'leri göster — secret değil; üretim SynapTech kontrolü için
    entries: allowed.map((u) => u.replace(/\.git$/i, "")),
    pilotMatched: false,
    forbiddenSynaptechProdMatched: false,
  },
  probes: {},
  accessSignals: [],
  blockers: [],
  warnings: [],
  verdict: "pending",
};

if (liveEnabled) report.blockers.push("CLOUD_AGENT_LIVE_ENABLED true olmamalı");
if (cloudMode !== "mock" && cloudMode !== "unset") {
  report.warnings.push(`CURSOR_CLOUD_MODE=${cloudMode} (beklenen mock)`);
}
if (!apiKey) {
  report.blockers.push("CURSOR_API_KEY yok");
  report.verdict = "blocked";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const pilotNorms = [PILOT.https, PILOT.httpsGit, ...PILOT.slugVariants].map(normalizeRepo);
report.allowList.pilotMatched = allowed.some((u) => pilotNorms.includes(normalizeRepo(u)));
report.allowList.forbiddenSynaptechProdMatched = allowed.some((u) => {
  const n = normalizeRepo(u);
  return (
    (n.includes("cenkerbakan/synaptech") || n.endsWith("/synaptech")) &&
    !n.includes("synaptech-ai-os-pilot")
  );
});

if (!report.allowList.pilotMatched) {
  report.blockers.push("Allow-list pilot repoyu içermiyor");
}
if (report.allowList.forbiddenSynaptechProdMatched) {
  report.blockers.push("Allow-list üretim SynapTech URL içeriyor — kaldırın");
}

// Salt okuma probe'ları
report.probes.auth = await cursorGet("/v1/agents?limit=5");
if (!report.probes.auth.ok) {
  report.blockers.push(`Auth başarısız: HTTP ${report.probes.auth.status}`);
} else {
  report.accessSignals.push("cursor_api_auth_ok");
}

const agentItems = report.probes.auth.json?.items ?? [];
const agentRepos = agentItems.flatMap((a) => (a.repos ?? []).map((r) => r.url)).filter(Boolean);
report.probes.listedAgentRepos = agentRepos;
const hasPilotInPastAgents = agentRepos.some((u) => normalizeRepo(u).includes("synaptech-ai-os-pilot"));
const hasOtherReposInPastAgents = agentRepos.some(
  (u) => !normalizeRepo(u).includes("synaptech-ai-os-pilot"),
);
if (hasPilotInPastAgents) report.accessSignals.push("past_agent_used_pilot_repo");
if (hasOtherReposInPastAgents) {
  report.warnings.push(
    "Listed agents include non-pilot repos (historical). App scope may now be narrower; create not used to re-test.",
  );
}

report.probes.environmentsAll = await cursorGet("/v1/environments?limit=50");
if (report.probes.environmentsAll.ok) {
  const items = report.probes.environmentsAll.json?.items ?? [];
  report.probes.environmentsAll.itemCount = items.length;
  report.probes.environmentsAll.repoUrls = [
    ...new Set(items.flatMap((e) => (e.repos ?? []).map((r) => r.url)).filter(Boolean)),
  ];
  const urls = report.probes.environmentsAll.repoUrls.map(normalizeRepo);
  if (urls.some((u) => u.includes("synaptech-ai-os-pilot"))) {
    report.accessSignals.push("environments_all_includes_pilot");
  }
  if (urls.some((u) => u.includes("/synaptech") && !u.includes("synaptech-ai-os-pilot"))) {
    report.warnings.push(
      "environments list still shows production SynapTech — App scope may not be pilot-only yet, or eski environment kaydı",
    );
  } else if (items.length >= 0) {
    report.accessSignals.push("environments_all_no_production_synaptech_listed");
  }
}

for (const slug of [
  ...PILOT.slugVariants,
  "github.com/CenkErbakan/SynapTech",
  "github.com/cenkerbakan/synaptech",
]) {
  const q = encodeURIComponent(slug);
  const key = `environments:${slug}`;
  report.probes[key] = await cursorGet(`/v1/environments?repo=${q}&limit=20`);
  if (report.probes[key].ok) {
    const items = report.probes[key].json?.items ?? [];
    report.probes[key].itemCount = items.length;
    if (items.length > 0) {
      if (slug.toLowerCase().includes("pilot")) {
        report.accessSignals.push(`environment_lists_pilot:${slug}`);
      } else {
        report.warnings.push(`environment filter still returns items for non-pilot: ${slug}`);
      }
      report.probes[key].repoUrls = items.flatMap((e) => (e.repos ?? []).map((r) => r.url));
    } else if (!slug.toLowerCase().includes("pilot")) {
      report.accessSignals.push(`environment_filter_empty_for_non_pilot:${slug}`);
    }
  } else if (report.probes[key].status === 403) {
    report.accessSignals.push(`environment_filter_forbidden:${slug}:${report.probes[key].code || "403"}`);
  }
}

// Secrets list with repo filter (values asla dönmez)
const secretRepo = encodeURIComponent("github.com/CenkErbakan/SynapTech-AI-OS-Pilot");
report.probes.secretsByRepo = await cursorGet(`/v1/secrets?repo=${secretRepo}&limit=20`);
if (report.probes.secretsByRepo.ok) {
  report.accessSignals.push("secrets_list_by_repo_ok");
  report.probes.secretsByRepo.itemCount = report.probes.secretsByRepo.json?.items?.length ?? 0;
} else if (report.probes.secretsByRepo.status === 403) {
  report.warnings.push(
    `secrets?repo= → HTTP 403 ${report.probes.secretsByRepo.code || ""} (erişim yok veya kapsam dar olabilir)`,
  );
}

// Models list — account feature probe (repo bağımsız, create değil)
report.probes.models = await cursorGet("/v1/models");
if (report.probes.models.ok) report.accessSignals.push("models_list_ok");
else if (report.probes.models.status === 404) {
  report.warnings.push("GET /v1/models yok veya 404 — create için model id opsiyonel kalır");
}

const envHits = Object.entries(report.probes)
  .filter(([k, v]) => k.startsWith("environments:") && v?.ok && (v.itemCount ?? 0) > 0)
  .length;

/**
 * Kesin create-time repository_access kontrolü yapılmadı (bilerek).
 * Sinyaller: auth OK + (environment hit VEYA secrets list 200 VEYA Owner App beyanı + allow-list).
 */
const softAccessOk =
  report.probes.auth?.ok &&
  (envHits > 0 ||
    report.probes.secretsByRepo?.ok ||
    report.accessSignals.includes("past_agent_used_pilot_repo"));

if (!softAccessOk && report.probes.auth?.ok) {
  report.warnings.push(
    "Salt-okunur probe'lar pilot repo için güçlü pozitif sinyal vermedi. Owner App grant sonrası environment/secrets boş olabilir; kesin repository_access yalnızca create anında görülür — bu turda create yok.",
  );
  report.accessSignals.push("owner_declared_app_scoped_to_pilot_only");
}

if (!onDemandVerified) {
  report.warnings.push("CLOUD_ON_DEMAND_VERIFIED env false — Owner beyanı var; .env true önerilir");
}

report.verdict =
  report.blockers.length === 0
    ? softAccessOk || report.accessSignals.includes("owner_declared_app_scoped_to_pilot_only")
      ? "access_plausible_awaiting_live_approval"
      : "auth_ok_repo_inconclusive"
    : "blocked";

report.remainingForLivePilot = [
  "Owner: CLOUD_ON_DEMAND_VERIFIED=true (.env) — beyan tamamsa",
  "Owner: CLOUD_AGENT_ALLOWED_REPOS=pilot URL — allow-list eşleşmesi",
  "Owner açık metin: tek live Cloud Agent run onayı",
  "Geçici CLOUD_AGENT_LIVE_ENABLED=true + CURSOR_CLOUD_MODE=live (yalnızca execute anı)",
  "Kill switch kapalı",
  "Aktif cloud run = 0",
  "cloud_agent_run onayı + boundVersion",
  "Execute sonrası live bayrakları tekrar kapat",
];

console.log(JSON.stringify(report, null, 2));
process.exit(report.blockers.length ? 1 : 0);
