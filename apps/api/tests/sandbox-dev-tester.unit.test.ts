import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

process.env.NODE_ENV = "test";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";
process.env.AGENT_REPO_TOOLS_MODE = "off";
process.env.AGENT_SANDBOX_MODE = "off";
process.env.LOCAL_AGENT_EXECUTION_MODE = "off";
process.env.MODEL_PROVIDER = "mock";

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
        scripts: { test: "node --test test/demo.test.js" },
      },
      null,
      2,
    ),
    "utf8",
  );
  // Bilerek bozuk
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
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n", "utf8");
}

describe("Developer sandbox + Tester allow-list (fixture)", () => {
  let fixtureRoot = "";

  beforeEach(async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { clearTestFixtureBindings } = await import(
      "../src/ai/repo/project-repo-registry.js"
    );
    clearTestFixtureBindings();
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "synaptech-devtest-fix-"));
    writeFixture(fixtureRoot);
  });

  afterEach(async () => {
    const { clearTestFixtureBindings } = await import(
      "../src/ai/repo/project-repo-registry.js"
    );
    clearTestFixtureBindings();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("bozuk kodda test exit!=0; patch sonrası exit=0 ve diff kanıtı oluşur", async () => {
    const { materializeSandboxCopy, runAllowlistedSandboxCommand } = await import(
      "../src/ai/repo/sandbox-runner.js"
    );
    const { applySandboxPatches } = await import("../src/ai/repo/sandbox-patch.js");
    const { verifyAcceptanceIndependently } = await import(
      "../src/ai/repo/acceptance-verifier.js"
    );

    const { sandboxRoot } = materializeSandboxCopy(fixtureRoot, { maxFiles: 50 });
    const before = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "node_test",
      extraArgs: ["test/demo.test.js"],
      timeoutMs: 30_000,
    });
    expect(before.evidence.kind).toBe("sandbox_command");
    expect(before.ok).toBe(false);
    expect(before.evidence.exitCode).not.toBe(0);

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
      commitSha: "fixture",
    });
    expect(patch.ok).toBe(true);
    expect(patch.evidence.kind).toBe("sandbox_diff");
    expect(patch.evidence.stdoutDigest).not.toBe("empty");
    expect(patch.diffText).toContain("src/demo.js");

    // .env yazma reddedilir
    const denied = applySandboxPatches({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      patches: [{ path: ".env", content: "SECRET=1\n" }],
    });
    expect(denied.ok).toBe(false);
    expect(denied.rejected[0]?.reason).toMatch(/secret/);

    const after = await runAllowlistedSandboxCommand({
      projectSlug: "synaptech-ai-os",
      sandboxRoot,
      commandId: "node_test",
      extraArgs: ["test/demo.test.js"],
      timeoutMs: 30_000,
    });
    expect(after.ok).toBe(true);
    expect(after.evidence.exitCode).toBe(0);
    expect(after.evidence.stdoutDigest).toBeTruthy();

    const workBase = {
      summary: "fix",
      analysis: "fix",
      recommendations: [],
      acceptanceMet: true,
      acceptanceNotes: "",
      codeChangeApplied: true,
      evidenceUsed: [],
      risks: [],
      requiresOwnerApproval: true,
      toolEvidenceRefs: [],
      findingKind: "none" as const,
      draftKind: "none" as const,
      proposedPatches: [],
    };

    const dev = verifyAcceptanceIndependently({
      agentId: "developer",
      work: workBase,
      evidence: [patch.evidence],
      toolsEnabled: true,
    });
    expect(dev.codeChangeApplied).toBe(true);
    expect(dev.acceptanceMet).toBe(true);
    expect(dev.modelAcceptanceIgnored).toBe(true);

    const testerFail = verifyAcceptanceIndependently({
      agentId: "tester",
      work: workBase,
      evidence: [before.evidence],
      toolsEnabled: true,
    });
    expect(testerFail.acceptanceMet).toBe(false);

    const testerOk = verifyAcceptanceIndependently({
      agentId: "tester",
      work: { ...workBase, acceptanceMet: false },
      evidence: [after.evidence],
      toolsEnabled: true,
    });
    expect(testerOk.acceptanceMet).toBe(true);
    expect(testerOk.modelAcceptanceIgnored).toBe(true);
  });

  it("CTO: repo_read+yol atfı findingKind=none iken kapsamlı denetim sayılmaz", async () => {
    const { verifyAcceptanceIndependently } = await import(
      "../src/ai/repo/acceptance-verifier.js"
    );
    const evidence = [
      {
        kind: "repo_read" as const,
        projectSlug: "subify",
        path: "package.json",
        stdoutDigest: "abc123",
        summary: "ok",
        trusted: true,
      },
      {
        kind: "repo_read" as const,
        projectSlug: "subify",
        path: "frontend/package.json",
        stdoutDigest: "def456",
        summary: "ok",
        trusted: true,
      },
    ];
    const none = verifyAcceptanceIndependently({
      agentId: "cto",
      work: {
        summary: "inceleme",
        analysis: "package.json ve frontend/package.json okundu",
        recommendations: [],
        acceptanceMet: true,
        acceptanceNotes: "",
        codeChangeApplied: false,
        evidenceUsed: [],
        risks: [],
        requiresOwnerApproval: true,
        toolEvidenceRefs: [],
        findingKind: "none",
        proposedPatches: [],
      },
      evidence,
      toolsEnabled: true,
    });
    expect(none.acceptanceMet).toBe(false);

    const structure = verifyAcceptanceIndependently({
      agentId: "cto",
      work: {
        summary: "yapı",
        analysis: "package.json ve frontend/package.json envanteri",
        recommendations: [],
        acceptanceMet: true,
        acceptanceNotes: "",
        codeChangeApplied: false,
        evidenceUsed: [],
        risks: [],
        requiresOwnerApproval: true,
        toolEvidenceRefs: [],
        findingKind: "structure_inspection",
        proposedPatches: [],
      },
      evidence,
      toolsEnabled: true,
    });
    expect(structure.acceptanceMet).toBe(true);
    expect(structure.findingCategory).toBe("structure_inspection");

    const fakeDebt = verifyAcceptanceIndependently({
      agentId: "cto",
      work: {
        summary: "borç",
        analysis: "package.json ve frontend/package.json — kritik teknik borç var",
        recommendations: [],
        acceptanceMet: true,
        acceptanceNotes: "",
        codeChangeApplied: false,
        evidenceUsed: [],
        risks: ["teknik borç"],
        requiresOwnerApproval: true,
        toolEvidenceRefs: [],
        findingKind: "structure_inspection",
        proposedPatches: [],
      },
      evidence,
      toolsEnabled: true,
    });
    expect(fakeDebt.acceptanceMet).toBe(false);
  });
});
