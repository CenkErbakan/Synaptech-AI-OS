/**
 * Entegrasyon gözlemi — config beyanından ayrı.
 * Secret değerleri asla dönüşe/loga yazılmaz.
 * Cloud Agent create / On-Demand / push yok.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { getEnv } from "../lib/env.js";
import { getPrisma } from "../db/prisma.js";
import { getCursorCredentialStatus } from "../cursor/credentials.js";
import { LiveCursorCloudClient } from "../cursor/live-client.js";
import {
  listProjectRepoBindings,
  verifyLocalCheckoutRemote,
} from "../ai/repo/project-repo-registry.js";

export type TriState = "true" | "false" | "unknown";

function envKeyPresent(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.trim().length >= 8);
}

function which(cmd: string): string | null {
  const r = spawnSync(process.platform === "win32" ? "where.exe" : "which", [cmd], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  if (r.status !== 0) return null;
  const line = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

async function probeCursorConnectivity(opts: {
  apiKeyPresent: boolean;
  apiKey: string | undefined;
  baseUrl: string;
}): Promise<{
  connectivityVerified: TriState;
  probeMethod: string;
  message: string;
}> {
  if (!opts.apiKeyPresent || !opts.apiKey) {
    return {
      connectivityVerified: "false",
      probeMethod: "skipped_no_credential",
      message: "CURSOR_API_KEY yok veya kısa — uzak doğrulama yapılmadı.",
    };
  }

  // Salt-okunur: GET /v1/agents?limit=1 — create kapalı
  try {
    const client = new LiveCursorCloudClient({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      liveCreateEnabled: false,
      timeoutMs: 15_000,
    });
    const result = await client.verifyConnection();
    return {
      connectivityVerified: result.ok ? "true" : "false",
      probeMethod: "GET /v1/agents?limit=1",
      message: result.message.slice(0, 300),
    };
  } catch (err) {
    return {
      connectivityVerified: "unknown",
      probeMethod: "GET /v1/agents?limit=1",
      message: err instanceof Error ? err.message.slice(0, 300) : "probe_failed",
    };
  }
}

async function probeGithubApiReadonly(repoUrl: string | null): Promise<{
  ok: TriState;
  status: number | null;
  message: string;
}> {
  if (!repoUrl) {
    return { ok: "unknown", status: null, message: "repo_url_missing" };
  }
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (!m) {
    return { ok: "unknown", status: null, message: "not_github_url" };
  }
  const owner = m[1]!;
  const repo = m[2]!;
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim() ||
    "";

  if (!token) {
    // Token yok — git ls-remote ile yerel kimlik üzerinden salt-okunur deneme
    const ls = spawnSync("git", ["ls-remote", "--heads", repoUrl], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    if (ls.status === 0 && (ls.stdout || "").trim().length > 0) {
      return {
        ok: "true",
        status: null,
        message: "git_ls_remote_ok (GitHub App kanıtı değil)",
      };
    }
    return {
      ok: "unknown",
      status: null,
      message: "GITHUB_TOKEN yok; git ls-remote başarısız veya kimlik yok",
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "synaptech-ai-os-integration-observe",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    // Token değerini asla loglama
    if (res.status === 200) {
      return { ok: "true", status: 200, message: "repos_get_ok (token API; App kanıtı değil)" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: "false", status: res.status, message: "auth_or_permission_denied" };
    }
    if (res.status === 404) {
      return { ok: "false", status: 404, message: "not_found_or_no_access" };
    }
    return { ok: "unknown", status: res.status, message: `http_${res.status}` };
  } catch (err) {
    return {
      ok: "unknown",
      status: null,
      message: err instanceof Error ? err.message.slice(0, 200) : "fetch_failed",
    };
  }
}

export async function buildIntegrationObservation() {
  const env = getEnv();
  const prisma = getPrisma();
  const now = new Date().toISOString();

  // --- Config beyanı (dosya; otomatik yazılmaz) ---
  const configDeclared = {
    source: "config/system-status.yaml" as const,
    cursor: "none" as const,
    github: "not_connected" as const,
    note: "Statik beyan — canlı probe sonucu değil. Ajan bu dosyayı değiştirmez.",
  };

  // --- Cursor ---
  const creds = getCursorCredentialStatus(env);
  // getEnv zod parse — key process.env'den gelir; değer dönülmez
  const apiKeyPresent = creds.configured;
  const cursorProbe = await probeCursorConnectivity({
    apiKeyPresent,
    apiKey: env.CURSOR_API_KEY,
    baseUrl: env.CURSOR_API_BASE_URL,
  });

  const pastRuns = await prisma.agentRun.findMany({
    where: {
      OR: [
        { cursorAgentId: { not: null } },
        { cursorRunId: { not: null } },
        { executionMode: { in: ["live", "mock"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      status: true,
      executionMode: true,
      cursorAgentId: true,
      cursorRunId: true,
      createdAt: true,
      finishedAt: true,
      githubRepository: true,
    },
  });

  const pastSuccessfulLive = pastRuns.find(
    (r) =>
      r.executionMode === "live" &&
      r.cursorAgentId &&
      (r.status === "completed" ||
        r.status === "finished" ||
        r.status === "done" ||
        r.status === "succeeded" ||
        Boolean(r.finishedAt)),
  );
  const pastAnyPilot = pastRuns.length > 0;
  const pastSuccessful =
    Boolean(pastSuccessfulLive) ||
    pastRuns.some(
      (r) =>
        r.cursorAgentId &&
        (r.status === "completed" ||
          r.status === "FINISHED" ||
          r.status === "done" ||
          r.finishedAt != null),
    );

  const cursorObserved = {
    ideOpenIsNotProof: true,
    credentialConfigured: apiKeyPresent,
    credentialSource: creds.source,
    connectivityVerified: cursorProbe.connectivityVerified,
    connectivityProbe: cursorProbe.probeMethod,
    connectivityMessage: cursorProbe.message,
    liveEnabled: Boolean(env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE === "live"),
    cursorCloudMode: env.CURSOR_CLOUD_MODE,
    cloudAgentLiveFlag: env.CLOUD_AGENT_LIVE_ENABLED,
    onDemandVerified: env.CLOUD_ON_DEMAND_VERIFIED,
    pastSuccessfulRun: pastSuccessful,
    pastPilotExists: pastAnyPilot,
    pastSuccessfulLiveRun: Boolean(pastSuccessfulLive),
    pastRunSampleCount: pastRuns.length,
    allowedReposCount: creds.allowedRepositories.length,
    label: !apiKeyPresent
      ? "Cursor Cloud: credential yok"
      : cursorProbe.connectivityVerified === "true"
        ? env.CLOUD_AGENT_LIVE_ENABLED && env.CURSOR_CLOUD_MODE === "live"
          ? "Cursor Cloud: bağlantı doğrulandı · live açık"
          : "Cursor Cloud: credential+bağlantı OK · live kapalı"
        : cursorProbe.connectivityVerified === "false"
          ? "Cursor Cloud: credential var · bağlantı başarısız"
          : "Cursor Cloud: credential var · bağlantı UNKNOWN",
  };

  // --- GitHub ---
  const ghCliPath = which("gh");
  const githubTokenPresent =
    envKeyPresent("GITHUB_TOKEN") || envKeyPresent("GH_TOKEN") || envKeyPresent("GITHUB_PAT");
  const githubAppIdPresent = envKeyPresent("GITHUB_APP_ID");
  const githubAppPemPresent = Boolean(
    process.env.GITHUB_APP_PRIVATE_KEY?.trim() ||
      process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim(),
  );

  // App kurulumu: yalnızca doğrulanabilir kaynak varsa
  let appInstall: TriState = "unknown";
  let appInstallMessage =
    "GitHub App kurulumu doğrulanabilir kaynak yok → UNKNOWN (API token App sayılmaz)";
  if (githubAppIdPresent && githubAppPemPresent) {
    appInstall = "unknown";
    appInstallMessage =
      "GITHUB_APP_ID + private key env var var; kurulum doğrulaması için App API çağrısı yapılmadı (güvenli varsayılan UNKNOWN)";
  }

  const bindings = await listProjectRepoBindings();
  const projects = await Promise.all(
    bindings.map(async (b) => {
      const localCheck =
        b.githubRepoUrl && b.localReadRoot
          ? verifyLocalCheckoutRemote(b.localReadRoot, b.githubRepoUrl)
          : b.localReadRoot
            ? {
                ok: existsSync(b.localReadRoot),
                remote: null as string | null,
                headSha: null as string | null,
                reason: existsSync(b.localReadRoot) ? "no_github_url" : "missing",
              }
            : { ok: false, remote: null, headSha: null, reason: "no_local_root" };

      const api = await probeGithubApiReadonly(b.githubRepoUrl);

      return {
        slug: b.projectSlug,
        githubRepoUrl: b.githubRepoUrl,
        localReadRoot: b.localReadRoot
          ? path.basename(b.localReadRoot) // tam yol yerine ipucu; Windows user path sızıntısını azalt
          : null,
        localReadRootSet: Boolean(b.localReadRoot),
        verified: b.verified,
        verifiedBy: b.verifiedBy,
        bindingSource: b.source,
        readOnly: b.readOnly,
        writeAllowed: b.writeAllowed,
        localRemoteMatches: localCheck.ok,
        localRemote: localCheck.remote,
        localHeadSha: localCheck.headSha,
        apiReadonlyAccess: api.ok,
        apiReadonlyMessage: api.message,
        evidenceNotes: b.evidenceNotes.slice(0, 6),
        blockedReason: b.blockedReason,
      };
    }),
  );

  // Temsilî API erişimi: Subify verified veya herhangi bir true
  const anyApiOk = projects.some((p) => p.apiReadonlyAccess === "true");
  const anyApiFalse = projects.every(
    (p) => p.apiReadonlyAccess === "false" || p.apiReadonlyAccess === "unknown",
  );

  const githubObserved = {
    ideOrBrowserIsNotProof: true,
    cliInstalled: Boolean(ghCliPath),
    cliPath: ghCliPath ? "gh" : null,
    cliAuth: ghCliPath ? ("unknown" as TriState) : ("false" as TriState),
    cliAuthNote: ghCliPath
      ? "gh kurulu; auth durumu bu turda sorgulanmadı (ek çağrı yok)"
      : "gh PATH'te yok",
    tokenConfigured: githubTokenPresent,
    apiReadonlyAccess: anyApiOk ? ("true" as TriState) : anyApiFalse ? ("unknown" as TriState) : ("unknown" as TriState),
    appInstallVerified: appInstall,
    appInstallMessage,
    note: "GitHub API/token erişimi GitHub App kurulumu demek değildir.",
    label:
      appInstall === "true"
        ? "GitHub App: doğrulandı"
        : anyApiOk
          ? "GitHub: repo erişimi var · App UNKNOWN"
          : githubTokenPresent
            ? "GitHub: token var · erişim belirsiz · App UNKNOWN"
            : "GitHub App: doğrulanmadı (UNKNOWN) · token yok",
  };

  const differences = [
    {
      field: "cursor",
      configDeclared: configDeclared.cursor,
      observed: cursorObserved.label,
      diverge: configDeclared.cursor === "none" && apiKeyPresent,
    },
    {
      field: "github_app",
      configDeclared: configDeclared.github,
      observed: githubObserved.label,
      diverge: true, // App hâlâ UNKNOWN/not verified — config not_connected ile uyumlu olabilir
    },
  ];

  const missingConfig: string[] = [];
  if (!apiKeyPresent) missingConfig.push("CURSOR_API_KEY");
  if (!env.CLOUD_AGENT_LIVE_ENABLED) {
    missingConfig.push("CLOUD_AGENT_LIVE_ENABLED=true (bilinçli kapalı olabilir)");
  }
  if (env.CURSOR_CLOUD_MODE !== "live") {
    missingConfig.push("CURSOR_CLOUD_MODE=live (şu an mock — bilinçli)");
  }
  if (!githubTokenPresent && !anyApiOk) {
    missingConfig.push("GITHUB_TOKEN veya çalışan git credentials (private repo API)");
  }
  if (appInstall !== "true") {
    missingConfig.push("Doğrulanmış GitHub App kurulumu (App ID + kurulum kanıtı)");
  }
  for (const p of projects) {
    if (!p.verified) missingConfig.push(`Verified MSSQL githubRepoUrl: ${p.slug}`);
  }

  return {
    source: "api" as const,
    generatedAt: now,
    continuousAutomation: false,
    modesUnchanged: {
      schedulerAiCeoMode: env.SCHEDULER_AI_CEO_MODE,
      cloudLiveEnabled: env.CLOUD_AGENT_LIVE_ENABLED,
      cursorCloudMode: env.CURSOR_CLOUD_MODE,
      localAgentExecutionMode: env.LOCAL_AGENT_EXECUTION_MODE,
      agentSandboxMode: env.AGENT_SANDBOX_MODE,
    },
    configDeclaredStatus: configDeclared,
    observedRuntimeStatus: {
      cursor: cursorObserved,
      github: githubObserved,
      projects,
    },
    differences,
    missingConfiguration: missingConfig,
    safety: {
      noCloudAgentCreated: true,
      noOnDemandEnabled: true,
      noPushMergeDeploy: true,
      secretsRedacted: true,
      correctCredentialExport: "getCursorCredentialStatus (resolveCursorCredentials yok)",
    },
  };
}

export type IntegrationObservation = Awaited<ReturnType<typeof buildIntegrationObservation>>;
