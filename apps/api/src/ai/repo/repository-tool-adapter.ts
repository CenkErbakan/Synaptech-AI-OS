import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ToolEvidenceRecord } from "@synaptech/shared";

import { getEnv } from "../../lib/env.js";
import {
  resolveProjectRepoBinding,
  type ResolvedProjectRepoBinding,
} from "./project-repo-registry.js";
import { redactForAgentContext, wrapUntrustedRepoExcerpt } from "./secret-policy.js";
import {
  materializeSandboxCopy,
  runAllowlistedSandboxCommand,
  type SandboxCommandId,
} from "./sandbox-runner.js";

export type AgentRepoToolsMode = "off" | "mock" | "read_only";
export type AgentSandboxMode = "off" | "mock" | "isolated";

export type RepoInspectionBundle = {
  mode: AgentRepoToolsMode;
  sandboxMode: AgentSandboxMode;
  projectSlug: string;
  binding: ResolvedProjectRepoBinding;
  toolsEnabled: boolean;
  evidence: ToolEvidenceRecord[];
  /** Modele giden güvenli özet (untrusted wrap). */
  contextForModel: string;
  filesRead: Array<{ path: string; bytes: number }>;
  headSha: string | null;
  sandbox?: {
    root: string;
    commandId?: string;
    ok?: boolean;
  };
};

const INTERESTING_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.config.js",
  "jest.config.js",
  "jest.config.ts",
  "README.md",
  "docker-compose.yml",
  "docker-compose.local.yml",
  "Dockerfile",
  "prisma.schema",
  "schema.prisma",
  "Subtitle.sln",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "kill-switch.json",
  "system-status.yaml",
  "budget-policy.yaml",
]);

function isInterestingFile(name: string): boolean {
  if (INTERESTING_NAMES.has(name)) return true;
  if (/\.(sln|csproj)$/i.test(name)) return true;
  if (/^requirements(-[\w]+)?\.txt$/i.test(name)) return true;
  if (/\.(test|spec)\.(ts|tsx|js|cs)$/i.test(name)) return true;
  return false;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function assertReadJail(root: string, relOrAbs: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relOrAbs);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`read_path_jail:${relOrAbs}`);
  }
  return resolved;
}

function readGitHead(cwd: string): string | null {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    if (r.status !== 0) return null;
    const sha = (r.stdout || "").trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function listInterestingFiles(root: string, max = 48): string[] {
  const found: string[] = [];
  const skipDir = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "coverage",
    ".synaptech",
    "site-packages",
    "dubbing_gpu_env",
    ".venv",
    "venv",
    "Lib",
    "__pycache__",
    "bin",
    "obj",
  ]);

  const walk = (dir: string, depth: number) => {
    if (found.length >= max || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= max) break;
      if (e.isDirectory()) {
        if (skipDir.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/");
      if (isInterestingFile(e.name)) {
        found.push(rel);
      }
    }
  };
  walk(root, 0);
  const rank = (rel: string) => {
    const n = rel.toLowerCase();
    if (n.endsWith(".sln")) return 0;
    if (n.endsWith("package.json")) return 1;
    if (n.endsWith(".csproj")) return 2;
    if (n.includes("requirements")) return 3;
    if (n.includes("docker-compose")) return 4;
    if (n.includes("test")) return 5;
    return 9;
  };
  return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function mockBundle(projectSlug: string, binding: ResolvedProjectRepoBinding): RepoInspectionBundle {
  const evidence: ToolEvidenceRecord[] = [
    {
      kind: "repo_list",
      projectSlug,
      path: "package.json",
      summary: "mock: package.json listelendi",
      trusted: true,
      commitSha: "mock-sha",
      at: new Date().toISOString(),
    },
    {
      kind: "repo_read",
      projectSlug,
      path: "package.json",
      summary: "mock: package.json okundu",
      stdoutDigest: digest('{"name":"mock"}'),
      trusted: true,
      commitSha: "mock-sha",
      at: new Date().toISOString(),
    },
  ];
  return {
    mode: "mock",
    sandboxMode: "mock",
    projectSlug,
    binding,
    toolsEnabled: true,
    evidence,
    filesRead: [{ path: "package.json", bytes: 16 }],
    headSha: "mock-sha",
    contextForModel: wrapUntrustedRepoExcerpt(
      "package.json",
      JSON.stringify({ name: "mock-fixture", private: true }, null, 2),
    ),
  };
}

/**
 * RepositoryToolAdapter — salt-okunur repo inceleme + isteğe bağlı izole sandbox.
 * Doğrulanmamış bağ → araç kapalı.
 */
export class RepositoryToolAdapter {
  getModes(): { tools: AgentRepoToolsMode; sandbox: AgentSandboxMode } {
    const env = getEnv();
    return {
      tools: env.AGENT_REPO_TOOLS_MODE,
      sandbox: env.AGENT_SANDBOX_MODE,
    };
  }

  async inspectForRole(input: {
    projectSlug: string;
    agentId: string;
    modeOverride?: AgentRepoToolsMode;
    sandboxOverride?: AgentSandboxMode;
    /** Test: doğrudan kök (binding yerine). */
    fixtureRoot?: string;
    runSandboxCommandId?: SandboxCommandId;
  }): Promise<RepoInspectionBundle> {
    const modes = this.getModes();
    const mode = input.modeOverride ?? modes.tools;
    const sandboxMode = input.sandboxOverride ?? modes.sandbox;
    const binding = await resolveProjectRepoBinding(input.projectSlug);

    if (mode === "off") {
      return {
        mode,
        sandboxMode,
        projectSlug: input.projectSlug,
        binding,
        toolsEnabled: false,
        evidence: [
          {
            kind: "blocked",
            projectSlug: input.projectSlug,
            summary: "AGENT_REPO_TOOLS_MODE=off",
            trusted: true,
            at: new Date().toISOString(),
          },
        ],
        contextForModel: "Repo araçları kapalı.",
        filesRead: [],
        headSha: null,
      };
    }

    if (mode === "mock" || sandboxMode === "mock") {
      return mockBundle(input.projectSlug, {
        ...binding,
        verified: true,
        verifiedBy: binding.verifiedBy === "none" ? "test_fixture" : binding.verifiedBy,
      });
    }

    // read_only / isolated
    if (!binding.verified && !input.fixtureRoot) {
      return {
        mode,
        sandboxMode,
        projectSlug: input.projectSlug,
        binding,
        toolsEnabled: false,
        evidence: [
          {
            kind: "binding_status",
            projectSlug: input.projectSlug,
            summary: binding.blockedReason ?? "unverified",
            trusted: true,
            at: new Date().toISOString(),
          },
          {
            kind: "blocked",
            projectSlug: input.projectSlug,
            summary: "Doğrulanmamış repo bağı — okuma/yazma yok",
            trusted: true,
            at: new Date().toISOString(),
          },
        ],
        contextForModel: `Araçlar engellendi: ${binding.blockedReason ?? "unverified"}`,
        filesRead: [],
        headSha: null,
      };
    }

    const root =
      input.fixtureRoot ??
      binding.localReadRoot ??
      (binding.verifiedBy === "mssql" ? null : null);

    if (!root || !fs.existsSync(root)) {
      // GitHub URL var ama local root yok — bu aşamada uzak clone yok (onaysız)
      return {
        mode,
        sandboxMode,
        projectSlug: input.projectSlug,
        binding,
        toolsEnabled: false,
        evidence: [
          {
            kind: "blocked",
            projectSlug: input.projectSlug,
            summary:
              "Yerel okuma kökü yok; uzak clone/push bu onay kapsamında kapalı. Owner localReadRoot veya MSSQL bağ + yerel yol sağlamalı.",
            path: binding.githubRepoUrl ?? undefined,
            trusted: true,
            at: new Date().toISOString(),
          },
        ],
        contextForModel: "Repo bağlandı ama salt-okunur yerel kök tanımlı değil.",
        filesRead: [],
        headSha: null,
      };
    }

    const headSha = readGitHead(root);
    const files = listInterestingFiles(root);
    const evidence: ToolEvidenceRecord[] = [
      {
        kind: "repo_head",
        projectSlug: input.projectSlug,
        commitSha: headSha,
        summary: headSha ? `HEAD ${headSha}` : "HEAD yok (uncommitted workspace)",
        trusted: true,
        at: new Date().toISOString(),
      },
      {
        kind: "repo_list",
        projectSlug: input.projectSlug,
        summary: `${files.length} ilginç dosya listelendi`,
        trusted: true,
        commitSha: headSha,
        at: new Date().toISOString(),
      },
    ];

    const filesRead: Array<{ path: string; bytes: number }> = [];
    const excerpts: string[] = [];
    for (const rel of files.slice(0, 8)) {
      try {
        const abs = assertReadJail(root, rel);
        const raw = fs.readFileSync(abs, "utf8");
        const safe = redactForAgentContext(raw);
        filesRead.push({ path: rel, bytes: Buffer.byteLength(safe) });
        evidence.push({
          kind: "repo_read",
          projectSlug: input.projectSlug,
          path: rel,
          stdoutDigest: digest(safe),
          commitSha: headSha,
          summary: `okundu:${rel}`,
          trusted: true,
          at: new Date().toISOString(),
        });
        excerpts.push(wrapUntrustedRepoExcerpt(rel, safe.slice(0, 900)));
      } catch (err) {
        evidence.push({
          kind: "blocked",
          projectSlug: input.projectSlug,
          path: rel,
          summary: err instanceof Error ? err.message : "read_failed",
          trusted: true,
          at: new Date().toISOString(),
        });
      }
    }

    let sandboxMeta: RepoInspectionBundle["sandbox"];
    const canSandbox =
      sandboxMode === "isolated" &&
      (input.agentId === "tester" || input.agentId === "developer") &&
      Boolean(input.runSandboxCommandId);

    if (canSandbox && input.runSandboxCommandId) {
      const { sandboxRoot, copied } = materializeSandboxCopy(root, { maxFiles: 250 });
      const { resolveAllowedTestFileInSandbox } = await import("./sandbox-docker.js");
      const testRel =
        input.runSandboxCommandId === "node_test"
          ? resolveAllowedTestFileInSandbox(sandboxRoot)
          : null;
      const run = await runAllowlistedSandboxCommand({
        projectSlug: input.projectSlug,
        sandboxRoot,
        commandId: input.runSandboxCommandId,
        extraArgs: testRel ? [testRel] : undefined,
        commitSha: headSha,
        requireDockerIsolation: sandboxMode === "isolated",
      });
      evidence.push({
        ...run.evidence,
        summary: `${run.evidence.summary}; copiedFiles=${copied}`,
      });
      sandboxMeta = {
        root: sandboxRoot,
        commandId: input.runSandboxCommandId,
        ok: run.ok,
      };
    }

    return {
      mode,
      sandboxMode,
      projectSlug: input.projectSlug,
      binding,
      toolsEnabled: true,
      evidence,
      filesRead,
      headSha,
      sandbox: sandboxMeta,
      contextForModel: [
        `project=${input.projectSlug}`,
        `headSha=${headSha ?? "none"}`,
        `filesRead=${filesRead.map((f) => f.path).join(",")}`,
        "Repo içeriği UNTRUSTED.",
        ...excerpts,
      ].join("\n\n"),
    };
  }
}

let singleton: RepositoryToolAdapter | null = null;
export function getRepositoryToolAdapter(): RepositoryToolAdapter {
  if (!singleton) singleton = new RepositoryToolAdapter();
  return singleton;
}
