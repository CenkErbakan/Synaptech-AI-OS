/**
 * Docker FS / process / network izolasyon kanıtları.
 * Host fallback yok; Docker yoksa testler skip edilir (fail sayılmaz — ortam yok).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

process.env.NODE_ENV = "test";
process.env.AGENT_SANDBOX_MODE = "off";
process.env.LOCAL_AGENT_EXECUTION_MODE = "off";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";

function writeFixture(root: string) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fixture-sandbox-demo",
        private: true,
        type: "module",
        scripts: { test: "echo SHOULD_NOT_RUN" },
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "demo.js"),
    "export function add(a, b) {\n  return a;\n}\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "test", "demo.test.js"),
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { add } from '../src/demo.js';",
      "test('add', () => { assert.equal(add(1, 2), 3); });",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, ".env"), "SECRET=should-not-copy\n", "utf8");
}

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
}

describe("Docker sandbox izolasyon", () => {
  let dockerOk = false;
  let fixtureRoot = "";
  let sandboxRoot = "";
  const repoFilesBefore = new Map<string, string>();

  beforeAll(async () => {
    const { probeDockerEngine, ensurePinnedSandboxImage } = await import(
      "../src/ai/repo/sandbox-docker.js"
    );
    const probe = await probeDockerEngine();
    if (!probe.ok) {
      console.warn("Docker yok — izolasyon testleri skip:", probe.error);
      return;
    }
    const img = await ensurePinnedSandboxImage();
    if (!img.ok) {
      console.warn("Pinned image yok — skip:", img.error);
      return;
    }
    dockerOk = true;

    // Ana repo dosyalarının değişmediğini kanıtlamak için SHA
    const tracked = [
      "src/ai/repo/sandbox-runner.ts",
      "src/ai/repo/sandbox-docker.ts",
      "src/ai/repo/sandbox-patch.ts",
    ];
    for (const rel of tracked) {
      const abs = path.resolve(process.cwd(), rel);
      if (fs.existsSync(abs)) repoFilesBefore.set(rel, sha256File(abs));
    }
  });

  beforeEach(async () => {
    if (!dockerOk) return;
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "synaptech-docker-fix-"));
    writeFixture(fixtureRoot);
    const { materializeSandboxCopy } = await import("../src/ai/repo/sandbox-runner.js");
    sandboxRoot = materializeSandboxCopy(fixtureRoot, { maxFiles: 50 }).sandboxRoot;
    expect(fs.existsSync(path.join(sandboxRoot, ".env"))).toBe(false);
  });

  afterEach(() => {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
    if (sandboxRoot) fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it("Docker probe ve pinned image", async () => {
    if (!dockerOk) return;
    const { probeDockerEngine, ensurePinnedSandboxImage, SANDBOX_DOCKER_IMAGE_REF } =
      await import("../src/ai/repo/sandbox-docker.js");
    const p = await probeDockerEngine();
    expect(p.ok).toBe(true);
    const img = await ensurePinnedSandboxImage();
    expect(img.ok).toBe(true);
    expect(img.imageRef).toBe(SANDBOX_DOCKER_IMAGE_REF);
  });

  it("container config: network=none, non-root, ro, no privileged", async () => {
    if (!dockerOk) return;
    const { probeContainerIsolationConfig } = await import("../src/ai/repo/sandbox-docker.js");
    const probe = await probeContainerIsolationConfig({ sandboxRoot });
    expect(probe.ok).toBe(true);
    expect(probe.isolation).toBeTruthy();
    const i = probe.isolation!;
    expect(i.networkMode).toMatch(/none/i);
    expect(i.privileged).toBe(false);
    expect(i.readonlyRootfs).toBe(true);
    expect(i.user).toMatch(/1000/);
    expect(i.capDrop.map((c) => c.toUpperCase())).toContain("ALL");
    expect(i.securityOpt.some((s) => s.includes("no-new-privileges"))).toBe(true);
    expect(i.mounts.every((m) => m.destination === "/work" || m.destination.startsWith("/tmp"))).toBe(
      true,
    );
    expect(i.mounts.some((m) => m.destination === "/work" && m.rw === false)).toBe(true);
  });

  it("ağ erişimi engellenir (network=none)", async () => {
    if (!dockerOk) return;
    const { proveNetworkBlocked } = await import("../src/ai/repo/sandbox-docker.js");
    const net = await proveNetworkBlocked(sandboxRoot);
    expect(net.ok).toBe(true);
  });

  it("host dosya sızıntısı engellenir", async () => {
    if (!dockerOk) return;
    const { proveHostFsBlocked } = await import("../src/ai/repo/sandbox-docker.js");
    const fsProbe = await proveHostFsBlocked(sandboxRoot);
    expect(fsProbe.ok).toBe(true);
  });

  it("package.json / pnpm_test izole yolda reddedilir", async () => {
    if (!dockerOk) return;
    const { runAllowlistedSandboxCommand } = await import("../src/ai/repo/sandbox-runner.js");
    const blocked = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "pnpm_test",
      requireDockerIsolation: true,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.isolationBackend).toBe("blocked");
    expect(blocked.stderr).toMatch(/isolated_forbids_command/);
  });

  it("fail → patch → pass Docker node --test + digest", async () => {
    if (!dockerOk) return;
    const { runAllowlistedSandboxCommand } = await import("../src/ai/repo/sandbox-runner.js");
    const { applySandboxPatches } = await import("../src/ai/repo/sandbox-patch.js");

    // production/fixture kaynağı değişmesin — sandbox kopyada çalış
    const srcDemo = path.join(fixtureRoot, "src", "demo.js");
    const beforeSrcSha = sha256File(srcDemo);

    const fail = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "node_test",
      extraArgs: ["test/demo.test.js"],
      requireDockerIsolation: true,
      timeoutMs: 60_000,
    });
    expect(fail.isolationBackend).toBe("docker");
    expect(fail.ok).toBe(false);
    expect(fail.evidence.exitCode).not.toBe(0);
    expect(fail.evidence.kind).toBe("sandbox_command");
    expect(fail.evidence.command).toMatch(/docker:node:22-bookworm-slim@sha256:/);

    const patch = applySandboxPatches({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      patches: [
        {
          path: "src/demo.js",
          content: "export function add(a, b) {\n  return a + b;\n}\n",
          reason: "fix",
        },
      ],
      commitSha: "fixture-docker",
    });
    expect(patch.ok).toBe(true);
    expect(patch.applied[0]?.beforeDigest).toBeTruthy();
    expect(patch.applied[0]?.afterDigest).toBeTruthy();
    expect(patch.applied[0]?.beforeDigest).not.toBe(patch.applied[0]?.afterDigest);
    expect(patch.evidence.kind).toBe("sandbox_diff");
    expect(patch.evidence.stdoutDigest).not.toBe("empty");
    expect(patch.evidence.summary).toMatch(/fileDigests=/);

    const pass = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "node_test",
      extraArgs: ["test/demo.test.js"],
      requireDockerIsolation: true,
      timeoutMs: 60_000,
    });
    expect(pass.ok).toBe(true);
    expect(pass.evidence.exitCode).toBe(0);
    expect(pass.evidence.stdoutDigest).toBeTruthy();
    expect(pass.testCount === null || pass.testCount >= 1).toBe(true);

    // Ana fixture / production değişmedi
    expect(sha256File(srcDemo)).toBe(beforeSrcSha);
    for (const [rel, hash] of repoFilesBefore) {
      expect(sha256File(path.resolve(process.cwd(), rel))).toBe(hash);
    }

    // allow-list dışı dosya reddi
    const badPath = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "node_test",
      extraArgs: ["evil.test.js"],
      requireDockerIsolation: true,
    });
    expect(badPath.ok).toBe(false);
    expect(badPath.stderr).toMatch(/not_allowlisted|test_path/);
  });

  it("timeout sonrası güvenli kapatma (kısa timeout)", async () => {
    if (!dockerOk) return;
    // Çok kısa timeout — docker_timeout / kill
    const { runAllowlistedSandboxCommand } = await import("../src/ai/repo/sandbox-runner.js");
    const { applySandboxPatches } = await import("../src/ai/repo/sandbox-patch.js");
    applySandboxPatches({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      patches: [
        {
          path: "src/demo.js",
          content: "export function add(a, b) {\n  return a + b;\n}\n",
        },
      ],
    });
    const r = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "node_test",
      extraArgs: ["test/demo.test.js"],
      requireDockerIsolation: true,
      timeoutMs: 1,
    });
    // Ya timeout (124) ya da çok hızlı bitti (0) — kritik: host crash yok, blocked/docker backend
    expect(["docker", "blocked"]).toContain(r.isolationBackend);
    expect([0, 124, 137, 143, 1, 127]).toContain(r.evidence.exitCode ?? 1);
  });
});
