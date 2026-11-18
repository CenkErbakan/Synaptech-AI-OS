/**
 * Faz 4B — salt okunur Cursor API doğrulama.
 * POST /v1/agents veya run başlatma YOK.
 * Anahtar asla stdout'a yazılmaz.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const PILOT_REPO_URL = "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot";
const PILOT_REPO_SLUG = "github.com/cenkerbakan/synaptech-ai-os-pilot";

const apiKey = process.env.CURSOR_API_KEY;
const baseUrl = (process.env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(/\/$/, "");
const liveEnabled = ["1", "true", "yes", "on"].includes(
  String(process.env.CLOUD_AGENT_LIVE_ENABLED || "false").toLowerCase(),
);
const onDemandVerified = ["1", "true", "yes", "on"].includes(
  String(process.env.CLOUD_ON_DEMAND_VERIFIED || "false").toLowerCase(),
);
const allowed = String(process.env.CLOUD_AGENT_ALLOWED_REPOS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function redact(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/key_[A-Za-z0-9]+/gi, "[REDACTED]")
    .replace(/CURSOR_API_KEY\s*=\s*\S+/gi, "CURSOR_API_KEY=[REDACTED]");
}

async function cursorGet(pathname) {
  const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { parseError: true, preview: redact(text).slice(0, 200) };
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
  phase: "4B-prep-readonly",
  liveCreateAttempted: false,
  postAgentsCalled: false,
  liveEnabledFlag: liveEnabled,
  onDemandVerifiedEnv: onDemandVerified,
  apiKeyPresent: Boolean(apiKey && apiKey.length >= 8),
  apiKeyLength: apiKey ? apiKey.length : 0,
  allowedReposCount: allowed.length,
  pilotInAllowList: allowed.some((u) =>
    u.replace(/\.git$/i, "").toLowerCase().includes("synaptech-ai-os-pilot"),
  ),
  auth: null,
  environmentsByRepo: null,
  githubPublic: null,
  verdict: "pending",
  blockers: [],
};

if (!apiKey) {
  report.blockers.push("CURSOR_API_KEY yok");
  report.verdict = "blocked";
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (liveEnabled) {
  report.blockers.push("CLOUD_AGENT_LIVE_ENABLED true — bu hazırlık turunda false olmalı");
}

// 1) Kimlik doğrulama — salt okuma
report.auth = await cursorGet("/v1/agents?limit=1");
if (!report.auth.ok) {
  report.blockers.push(`Cursor auth başarısız: HTTP ${report.auth.status} ${report.auth.code || ""}`);
}

// 2) Ortam listesi (repo filtresi) — salt okuma; erişim sinyali
const repoQuery = encodeURIComponent("github.com/CenkErbakan/SynapTech-AI-OS-Pilot");
report.environmentsByRepo = await cursorGet(`/v1/environments?repo=${repoQuery}&limit=20`);

// 3) GitHub public metadata (Cursor dışı, salt okuma, push yok)
try {
  const gh = await fetch(`https://api.github.com/repos/CenkErbakan/SynapTech-AI-OS-Pilot`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "SynapTech-AI-OS-prep" },
  });
  const body = await gh.json();
  report.githubPublic = {
    ok: gh.ok,
    status: gh.status,
    full_name: body.full_name ?? null,
    private: body.private ?? null,
    default_branch: body.default_branch ?? null,
    permissions: body.permissions ?? null,
    html_url: body.html_url ?? null,
  };
  if (!gh.ok) {
    report.blockers.push(`GitHub public API: HTTP ${gh.status}`);
  }
} catch (error) {
  report.githubPublic = { ok: false, error: String(error?.message || error) };
  report.blockers.push("GitHub public API erişilemedi");
}

if (!report.pilotInAllowList) {
  report.blockers.push(
    "CLOUD_AGENT_ALLOWED_REPOS içinde pilot repo yok — Owner .env güncellemesi gerekli",
  );
}

if (!onDemandVerified) {
  report.blockers.push(
    "CLOUD_ON_DEMAND_VERIFIED henüz true değil — Owner beyanı sonrası .env güncellemesi",
  );
}

report.notes = {
  pilotRepoUrl: PILOT_REPO_URL,
  pilotRepoSlugHint: PILOT_REPO_SLUG,
  environmentsNote:
    "Boş environments listesi tek başına erişim yok demek değildir; named environment olmayabilir. Auth OK + repo public/accessible yeterli sinyal değildir — Cursor GitHub App bağlantısı Owner UI'da teyit edilmeli.",
  authItemCount: Array.isArray(report.auth?.json?.items) ? report.auth.json.items.length : null,
  envItemCount: Array.isArray(report.environmentsByRepo?.json?.items)
    ? report.environmentsByRepo.json.items.length
    : null,
};

report.verdict =
  report.auth?.ok && report.blockers.filter((b) => !b.includes("ALLOWED_REPOS") && !b.includes("ON_DEMAND")).length === 0
    ? report.blockers.length
      ? "auth_ok_config_pending"
      : "ready_for_owner_live_approval"
    : report.auth?.ok
      ? "auth_ok_with_blockers"
      : "blocked";

console.log(JSON.stringify(report, null, 2));
process.exit(report.auth?.ok ? 0 : 1);
