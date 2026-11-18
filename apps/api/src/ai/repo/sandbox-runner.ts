import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolEvidenceRecord } from "@synaptech/shared";

import { redactForAgentContext } from "./secret-policy.js";
import {
  assertAllowedIsolatedTestFile,
  ISOLATED_ALLOWED_TEST_FILES,
  resolveAllowedTestFileInSandbox,
  runIsolatedNodeTest,
  SANDBOX_DOCKER_IMAGE_REF,
} from "./sandbox-docker.js";

/**
 * Komut kataloğu.
 * İzole (Docker) modda yalnızca `node_test` + allow-list test dosyası kullanılır.
 * package.json scripts (pnpm_test/npm_test) izole yolda yasaktır.
 */
export const SANDBOX_COMMAND_ALLOWLIST = [
  {
    id: "node_test",
    argv: ["node", "--test"],
    description: "Node yerleşik test runner (izole: Docker + allow-list dosya)",
    isolatedAllowed: true,
  },
  {
    id: "pnpm_test",
    argv: ["pnpm", "test"],
    description: "Vitest/pnpm — yalnızca mock/host; izole Docker yolunda yasak",
    isolatedAllowed: false,
  },
  {
    id: "pnpm_typecheck",
    argv: ["pnpm", "typecheck"],
    description: "Typecheck — izole Docker yolunda yasak",
    isolatedAllowed: false,
  },
  {
    id: "pnpm_lint",
    argv: ["pnpm", "lint"],
    description: "Lint — izole Docker yolunda yasak",
    isolatedAllowed: false,
  },
  {
    id: "node_vitest_run_file",
    argv: ["pnpm", "exec", "vitest", "run"],
    description: "Vitest — izole Docker yolunda yasak",
    isolatedAllowed: false,
  },
  {
    id: "npm_test",
    argv: ["npm", "test"],
    description: "npm test — izole Docker yolunda yasak",
    isolatedAllowed: false,
  },
] as const;

export type SandboxCommandId = (typeof SANDBOX_COMMAND_ALLOWLIST)[number]["id"];

const DEFAULT_TIMEOUT_MS = 120_000;

export type SandboxRunResult = {
  ok: boolean;
  evidence: ToolEvidenceRecord;
  stdout: string;
  stderr: string;
  isolationBackend?: "docker" | "host" | "blocked";
  testCount?: number | null;
};

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`sandbox_path_jail_violation:${candidate}`);
  }
  return resolved;
}

/** İzole çalışma dizini oluştur (workspace dışı production değil; temp). */
export function createIsolatedSandboxDir(label = "synaptech-agent"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  return dir;
}

/**
 * Kaynak ağacın güvenli kopyası — secrets ve ağır klasörler hariç.
 * Ana çalışma dizininde kontrolsüz komut YOK; yalnızca kopyada çalışır.
 */
export function materializeSandboxCopy(
  sourceRoot: string,
  opts?: { maxFiles?: number },
): { sandboxRoot: string; copied: number; skipped: string[] } {
  const sandboxRoot = createIsolatedSandboxDir();
  const maxFiles = opts?.maxFiles ?? 400;
  const skipDir = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "coverage",
    ".sandbox",
    ".synaptech",
  ]);
  const skipFile = (name: string) =>
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key");

  let copied = 0;
  const skipped: string[] = [];

  const walk = (dir: string) => {
    if (copied >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (copied >= maxFiles) break;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDir.has(entry.name)) {
          skipped.push(entry.name);
          continue;
        }
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (skipFile(entry.name)) {
        skipped.push(entry.name);
        continue;
      }
      const rel = path.relative(sourceRoot, abs);
      const dest = assertInsideRoot(sandboxRoot, path.join(sandboxRoot, rel));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
      copied += 1;
    }
  };

  walk(path.resolve(sourceRoot));
  return { sandboxRoot, copied, skipped: [...new Set(skipped)].slice(0, 20) };
}

function parseNodeTestCount(stdout: string): number | null {
  // node --test TAP / reporter: "# tests 1" veya "tests 1"
  const m = stdout.match(/#\s*tests\s+(\d+)/i) || stdout.match(/\btests\s+(\d+)/i);
  if (m) return Number(m[1]);
  const pass = stdout.match(/#\s*pass\s+(\d+)/i);
  const fail = stdout.match(/#\s*fail\s+(\d+)/i);
  if (pass || fail) return (Number(pass?.[1] ?? 0) || 0) + (Number(fail?.[1] ?? 0) || 0);
  return null;
}

function blockedResult(
  projectSlug: string,
  reason: string,
  commitSha?: string | null,
): SandboxRunResult {
  return {
    ok: false,
    stdout: "",
    stderr: reason,
    isolationBackend: "blocked",
    evidence: {
      kind: "blocked",
      projectSlug,
      command: reason,
      summary: reason.slice(0, 500),
      trusted: true,
      commitSha: commitSha ?? null,
      at: new Date().toISOString(),
    },
  };
}

/**
 * İzole sandbox komutu.
 * requireDockerIsolation=true → yalnızca Docker; host fallback YOK.
 */
export async function runAllowlistedSandboxCommand(input: {
  projectSlug: string;
  sandboxRoot: string;
  commandId: SandboxCommandId;
  extraArgs?: string[];
  timeoutMs?: number;
  commitSha?: string | null;
  /** true: Docker zorunlu (AGENT_SANDBOX_MODE=isolated). */
  requireDockerIsolation?: boolean;
}): Promise<SandboxRunResult> {
  const spec = SANDBOX_COMMAND_ALLOWLIST.find((c) => c.id === input.commandId);
  if (!spec) {
    return blockedResult(input.projectSlug, "command_not_allowlisted", input.commitSha);
  }

  const cwd = path.resolve(input.sandboxRoot);
  if (!fs.existsSync(cwd)) {
    throw new Error(`sandbox_missing:${cwd}`);
  }

  const requireDocker = input.requireDockerIsolation === true;

  if (requireDocker) {
    if (!spec.isolatedAllowed || spec.id !== "node_test") {
      return blockedResult(
        input.projectSlug,
        `isolated_forbids_command:${spec.id}_use_node_test_only`,
        input.commitSha,
      );
    }

    let testRel: string;
    try {
      const raw = (input.extraArgs ?? [])[0];
      testRel = raw
        ? assertAllowedIsolatedTestFile(raw)
        : resolveAllowedTestFileInSandbox(cwd) ?? "";
      if (!testRel) {
        return blockedResult(
          input.projectSlug,
          `isolated_test_file_required:${ISOLATED_ALLOWED_TEST_FILES.join("|")}`,
          input.commitSha,
        );
      }
      assertAllowedIsolatedTestFile(testRel);
    } catch (err) {
      return blockedResult(
        input.projectSlug,
        err instanceof Error ? err.message : "test_path_rejected",
        input.commitSha,
      );
    }

    // Fazla argüman yok — model komut enjekte edemez
    if ((input.extraArgs ?? []).length > 1) {
      return blockedResult(
        input.projectSlug,
        "isolated_extra_args_rejected",
        input.commitSha,
      );
    }

    const container = await runIsolatedNodeTest({
      sandboxRoot: cwd,
      testRelPath: testRel,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    if (container.dockerUnavailable || container.blockedReason) {
      return blockedResult(
        input.projectSlug,
        container.blockedReason ?? "docker_unavailable_no_host_fallback",
        input.commitSha,
      );
    }

    const safeOut = redactForAgentContext(container.stdout).slice(0, 8000);
    const digest = createHash("sha256").update(safeOut).digest("hex").slice(0, 16);
    const testCount = parseNodeTestCount(container.stdout);
    const exitCode = container.exitCode;
    const evidence: ToolEvidenceRecord = {
      kind: "sandbox_command",
      projectSlug: input.projectSlug,
      command: `docker:${SANDBOX_DOCKER_IMAGE_REF} node --test /work/${testRel}`,
      exitCode,
      stdoutDigest: digest,
      commitSha: input.commitSha ?? null,
      durationMs: container.durationMs,
      summary: `docker_sandbox node_test exit=${exitCode} digest=${digest} tests=${testCount ?? "?"} image=${SANDBOX_DOCKER_IMAGE_REF}`,
      trusted: true,
      at: new Date().toISOString(),
    };

    return {
      ok: exitCode === 0 && (testCount === null || testCount > 0),
      stdout: safeOut,
      stderr: redactForAgentContext(container.stderr).slice(0, 4000),
      isolationBackend: "docker",
      testCount,
      evidence,
    };
  }

  // --- Host yolu (yalnızca mock / birim test; izolasyon iddiası YOK) ---
  const extra = (input.extraArgs ?? []).filter((a) => {
    if (/[;&|`$<>]/.test(a)) return false;
    if (a.includes("..")) return false;
    return a.length <= 200;
  });
  const argv = [...spec.argv, ...extra];
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          CI: "true",
        },
        windowsHide: true,
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: 124, stdout, stderr: `${stderr}\ntimeout` });
      }, timeoutMs);
      child.stdout?.on("data", (d) => {
        stdout += String(d).slice(0, 20_000);
      });
      child.stderr?.on("data", (d) => {
        stderr += String(d).slice(0, 20_000);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: String(err.message) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    },
  );

  const durationMs = Date.now() - started;
  const safeOut = redactForAgentContext(result.stdout).slice(0, 8000);
  const digest = createHash("sha256").update(safeOut).digest("hex").slice(0, 16);
  const exitCode = result.code ?? 1;
  const evidence: ToolEvidenceRecord = {
    kind: "sandbox_command",
    projectSlug: input.projectSlug,
    command: argv.join(" "),
    exitCode,
    stdoutDigest: digest,
    commitSha: input.commitSha ?? null,
    durationMs,
    summary: `host_sandbox ${input.commandId} exit=${exitCode} digest=${digest} (not_isolation_proven)`,
    trusted: true,
    at: new Date().toISOString(),
  };

  return {
    ok: exitCode === 0,
    stdout: safeOut,
    stderr: redactForAgentContext(result.stderr).slice(0, 4000),
    isolationBackend: "host",
    testCount: parseNodeTestCount(result.stdout),
    evidence,
  };
}

export { ISOLATED_ALLOWED_TEST_FILES, SANDBOX_DOCKER_IMAGE_REF };
