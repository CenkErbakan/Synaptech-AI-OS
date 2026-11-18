/**
 * T-P5E-006-retry — Owner onaylı tek seferlik Developer→Tester Docker+Ollama fixture pilotu.
 * Subify/Marivo/SynapTech/AI OS ana kaynak yazılmaz. Cloud/push/PR yok.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT_JSON = path.resolve(
  process.cwd(),
  "../../reports/qa/faz-5e-tp5e006-retry-live-result.json",
);
const OUT_MD = path.resolve(
  process.cwd(),
  "../../reports/qa/faz-5e-tp5e006-retry-live-rapor.md",
);

const BOUND = {
  "sandbox-docker.ts": "1A9A5BB95F09552E16649133FCDF9BAEE9A16C8D69DD506A73D91C916C671F96",
  "sandbox-runner.ts": "CA4227FC056BA7B1D255039C5CD1F84A35434B14801414FD152BDA363808DA98",
  "sandbox-patch.ts": "7B9025BAF93F1565CDFCE3F7B65FE68DC32BD9B49671B521FF1F7DAAAA9982B6",
  "local-agent-execution.ts": "B994200B26F145F10437FE0EE3EDB2D521DB7AB5C63E88121B5B499AE7947C5A",
  "repository-tool-adapter.ts": "5FB5763BB513AD8609515CCF0501A5B01AD6630EEBCAB124186F15198BBDE90B",
  "acceptance-verifier.ts": "7BC4B9919A9987BD672A7ABBFAF828F1CCCC896A122D91F16E81BFECB053A0EE",
} as const;

const IMAGE_DIGEST =
  "sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee";

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex").toUpperCase();
}

function writeBrokenFixture(root: string) {
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "test"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fixture-tp5e006-retry",
        private: true,
        type: "module",
        scripts: { test: "echo SHOULD_NOT_RUN_VIA_PACKAGE_JSON" },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    path.join(root, "src", "demo.js"),
    "export function add(a, b) {\n  return a;\n}\n",
    "utf8",
  );
  writeFileSync(
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
  writeFileSync(path.join(root, ".env"), "SECRET=must_not_copy\n", "utf8");
  writeFileSync(path.join(root, "README.md"), "# T-P5E-006-retry fixture\n", "utf8");
}

async function setEnvKeys(updates: Record<string, string>) {
  const { spawnSync } = await import("node:child_process");
  const args = Object.entries(updates).map(([k, v]) => `${k}=${v}`);
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", path.resolve(process.cwd(), "scripts/set-env-keys.ts"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  if (r.status !== 0) {
    throw new Error(`set-env-keys failed: ${r.stderr || r.stdout}`);
  }
  // Dosya yazıldı; bu süreçteki process.env + getEnv cache de güncellenmeli
  for (const [k, v] of Object.entries(updates)) {
    process.env[k] = v;
  }
}

async function main() {
  const startedAll = Date.now();
  const preflight: Record<string, unknown> = { at: new Date().toISOString() };

  // --- SHA ---
  const files = {
    "sandbox-docker.ts": path.resolve(process.cwd(), "src/ai/repo/sandbox-docker.ts"),
    "sandbox-runner.ts": path.resolve(process.cwd(), "src/ai/repo/sandbox-runner.ts"),
    "sandbox-patch.ts": path.resolve(process.cwd(), "src/ai/repo/sandbox-patch.ts"),
    "local-agent-execution.ts": path.resolve(process.cwd(), "src/ai/local-agent-execution.ts"),
    "repository-tool-adapter.ts": path.resolve(
      process.cwd(),
      "src/ai/repo/repository-tool-adapter.ts",
    ),
    "acceptance-verifier.ts": path.resolve(process.cwd(), "src/ai/repo/acceptance-verifier.ts"),
  };
  const shaCheck = Object.fromEntries(
    Object.entries(files).map(([name, p]) => {
      const actual = sha256File(p);
      const expected = BOUND[name as keyof typeof BOUND];
      return [name, { actual, expected, match: actual === expected }];
    }),
  );
  preflight.shaCheck = shaCheck;
  if (Object.values(shaCheck).some((s) => !(s as { match: boolean }).match)) {
    writeBlocked("sha_mismatch", preflight);
    return;
  }

  // --- Docker + isolation ---
  const {
    probeDockerEngine,
    ensurePinnedSandboxImage,
    probeContainerIsolationConfig,
    SANDBOX_DOCKER_IMAGE_DIGEST,
    SANDBOX_DOCKER_IMAGE_REF,
  } = await import("../src/ai/repo/sandbox-docker.js");
  const docker = await probeDockerEngine();
  const image = await ensurePinnedSandboxImage();
  preflight.docker = docker;
  preflight.image = {
    ok: image.ok,
    digestMatch: image.digest === IMAGE_DIGEST && image.digest === SANDBOX_DOCKER_IMAGE_DIGEST,
    ref: SANDBOX_DOCKER_IMAGE_REF,
  };
  if (!docker.ok || !image.ok || !preflight.image.digestMatch) {
    writeBlocked("docker_or_image_failed", preflight);
    return;
  }

  const probeRoot = mkdtempSync(path.join(os.tmpdir(), "tp5e006-iso-"));
  writeFileSync(path.join(probeRoot, "x"), "1");
  const iso = await probeContainerIsolationConfig({ sandboxRoot: probeRoot });
  rmSync(probeRoot, { recursive: true, force: true });
  preflight.isolation = iso.isolation;
  const i = iso.isolation;
  const isoOk =
    iso.ok &&
    i &&
    /none/i.test(i.networkMode) &&
    i.readonlyRootfs === true &&
    i.privileged === false &&
    /1000/.test(i.user) &&
    i.capDrop.map((c) => c.toUpperCase()).includes("ALL") &&
    i.securityOpt.some((s) => s.includes("no-new-privileges")) &&
    i.mounts.every((m) => m.destination === "/work" || m.destination.startsWith("/tmp")) &&
    !JSON.stringify(i).includes("docker.sock");
  preflight.isolationOk = isoOk;
  if (!isoOk) {
    writeBlocked("isolation_checks_failed", preflight);
    return;
  }

  // --- Modes / kill / ollama ---
  const { resetEnvCacheForTests, getEnv } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  let env = getEnv();
  const { getKillSwitch } = await import("../src/engines/kill-switch.js");
  const kill = await getKillSwitch();
  preflight.killSwitch = { enabled: kill.enabled };
  preflight.modesBefore = {
    cloudLive: env.CLOUD_AGENT_LIVE_ENABLED,
    cursorMode: env.CURSOR_CLOUD_MODE,
    onDemand: env.CLOUD_ON_DEMAND_VERIFIED,
    scheduler: env.SCHEDULER_AI_CEO_MODE,
    localAgent: env.LOCAL_AGENT_EXECUTION_MODE,
    repoTools: env.AGENT_REPO_TOOLS_MODE,
    sandbox: env.AGENT_SANDBOX_MODE,
    model: env.LOCAL_LLM_MODEL,
  };
  if (kill.enabled) {
    writeBlocked("kill_switch_on", preflight);
    return;
  }
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    writeBlocked("cloud_live_on", preflight);
    return;
  }
  if (env.CLOUD_ON_DEMAND_VERIFIED) {
    writeBlocked("on_demand_verified_unexpected", preflight);
    return;
  }
  if (env.SCHEDULER_AI_CEO_MODE !== "off") {
    writeBlocked("scheduler_not_off", preflight);
    return;
  }
  if (env.LOCAL_LLM_MODEL !== "qwen2.5:14b") {
    writeBlocked("wrong_model", preflight);
    return;
  }

  // Ollama probe
  // ensure modes allow local briefly for probe after we set env
  await setEnvKeys({
    LOCAL_AGENT_EXECUTION_MODE: "local",
    AGENT_REPO_TOOLS_MODE: "read_only",
    AGENT_SANDBOX_MODE: "isolated",
    SCHEDULER_AI_CEO_MODE: "off",
    CLOUD_AGENT_LIVE_ENABLED: "false",
    CURSOR_CLOUD_MODE: "mock",
    CLOUD_ON_DEMAND_VERIFIED: "false",
    MODEL_PROVIDER: "local",
    LOCAL_LLM_MODEL: "qwen2.5:14b",
    // Owner pilot: günlük tavanı geçici yükselt (şema max 48); bitince eski değere dönülür.
    LOCAL_AGENT_EXECUTION_MAX_PER_DAY: "48",
  });
  resetEnvCacheForTests();
  env = getEnv();
  const { requireLocalModelProvider, resetModelProviderForTests } = await import(
    "../src/ai/providers/registry.js"
  );
  resetModelProviderForTests();
  const provider = await requireLocalModelProvider();
  const probe = await provider.probe();
  preflight.ollama = { ok: probe.ok, message: probe.message };
  if (!probe.ok) {
    await shutdownModes();
    writeBlocked("ollama_unavailable", preflight);
    return;
  }
  const { assertLocalAgentExecutionDailyBudget } = await import("../src/ai/llm-call-guard.js");
  const budget = await assertLocalAgentExecutionDailyBudget();
  preflight.budget = budget;
  if (!budget.ok || budget.max - budget.used < 2) {
    await shutdownModes();
    writeBlocked("daily_budget_insufficient_for_two_calls", preflight);
    return;
  }

  // LLM lease — başka iş olmamalı
  const { acquireLocalLlmCallLease, releaseLocalLlmCallLease } = await import(
    "../src/ai/llm-call-guard.js"
  );
  const lease = await acquireLocalLlmCallLease(5_000, "tp5e006-preflight");
  preflight.llmLeaseFree = lease.acquired;
  if (lease.acquired) await releaseLocalLlmCallLease();
  else {
    await shutdownModes();
    writeBlocked("llm_lease_busy", preflight);
    return;
  }

  const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
  const { writeAudit } = await import("../src/engines/audit.js");
  const prisma = getPrisma();

  await writeAudit({
    category: "autonomy",
    action: "approval.owner_tp5e006_retry",
    actorKind: "owner",
    summary: "T-P5E-006-retry Owner onayı: Docker izolasyonlu Developer→Tester fixture (tek sefer).",
    metadata: {
      taskId: "T-P5E-006-retry",
      type: "real_ai_provider_pilot",
      projectSlug: "synaptech-ai-os",
      fixtureOnly: true,
      maxLlmCalls: 2,
      dockerImage: SANDBOX_DOCKER_IMAGE_REF,
      shaMatch: true,
      cloudAllowed: false,
      pushAllowed: false,
    },
  });

  // Fixture
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "tp5e006-fixture-"));
  writeBrokenFixture(fixtureRoot);
  const { registerTestFixtureBinding, clearTestFixtureBindings } = await import(
    "../src/ai/repo/project-repo-registry.js"
  );
  registerTestFixtureBinding({
    projectSlug: "synaptech-ai-os",
    githubRepoUrl: null,
    localReadRoot: fixtureRoot,
    verified: true,
    verifiedBy: "test_fixture",
    evidenceNotes: ["T-P5E-006-retry owner fixture"],
    readOnly: true,
    writeAllowed: false,
  });

  const {
    materializeSandboxCopy,
    runAllowlistedSandboxCommand,
  } = await import("../src/ai/repo/sandbox-runner.js");

  // Baseline fail in Docker
  const baselineCopy = materializeSandboxCopy(fixtureRoot, { maxFiles: 50 });
  const failRun = await runAllowlistedSandboxCommand({
    projectSlug: "synaptech-ai-os",
    sandboxRoot: baselineCopy.sandboxRoot,
    commandId: "node_test",
    extraArgs: ["test/demo.test.js"],
    requireDockerIsolation: true,
    timeoutMs: 60_000,
  });
  preflight.baselineFail = {
    ok: failRun.ok,
    exitCode: failRun.evidence.exitCode,
    digest: failRun.evidence.stdoutDigest,
    backend: failRun.isolationBackend,
    command: failRun.evidence.command,
  };
  if (failRun.ok || failRun.evidence.exitCode === 0 || failRun.isolationBackend !== "docker") {
    clearTestFixtureBindings();
    await shutdownModes();
    writeBlocked("baseline_fail_not_observed", preflight);
    return;
  }

  const project = await prisma.project.findUnique({ where: { slug: "synaptech-ai-os" } });
  if (!project) {
    clearTestFixtureBindings();
    await shutdownModes();
    writeBlocked("project_missing", preflight);
    return;
  }

  const stamp = Date.now().toString(36);
  const origin = `owner-pilot:T-P5E-006-retry-${stamp}`;
  const parentId = randomUUID();
  const developerId = randomUUID();
  const testerId = randomUUID();

  const parent = await prisma.task.create({
    data: {
      id: parentId,
      title: `T-P5E-006-retry parent ${stamp}`.slice(0, 140),
      description:
        "Owner onaylı tek seferlik fixture. Ana repo/Subify/Marivo yazılmaz. Docker node --test only.",
      projectId: project.id,
      assigneeId: "ceo",
      priority: "high",
      status: "planned",
      source: "real",
      origin,
      idempotencyKey: `tp5e006-retry-parent-${stamp}`,
      executionPolicy: "AUTO",
      executionKind: "real_ai_pending",
      acceptanceCriteria:
        "Developer sandbox_diff; Tester docker exit=0 + digest; max 2 LLM; modes off after.",
    },
  });

  const developerTaskRow = await prisma.task.create({
    data: {
      id: developerId,
      title: `T-P5E-006-retry Developer ${stamp}`.slice(0, 140),
      description: [
        "Fixture: src/demo.js add(a,b) yanlışlıkla yalnızca a döndürüyor; test/demo.test.js add(1,2)===3 bekliyor.",
        "Yalnızca proposedPatches ile src/demo.js düzelt. Ana repo yazma yok. package.json scripts kullanma.",
        "JSON AgentWorkResult: proposedPatches=[{path:'src/demo.js', content:'export function add(a, b) {\\n  return a + b;\\n}\\n'}]",
      ].join("\n"),
      projectId: project.id,
      assigneeId: "developer",
      parentTaskId: parent.id,
      priority: "high",
      status: "planned",
      source: "real",
      origin,
      idempotencyKey: `tp5e006-retry-dev-${stamp}`,
      executionPolicy: "AUTO",
      executionKind: "real_ai_pending",
      acceptanceCriteria:
        "Bağımsız sandbox_diff non-empty; codeChangeApplied yalnızca diff ile; Docker dışı yazma yok.",
    },
  });

  const testerTaskRow = await prisma.task.create({
    data: {
      id: testerId,
      title: `T-P5E-006-retry Tester ${stamp}`.slice(0, 140),
      description:
        "Developer sandbox oturumundaki patch sonrası test/demo.test.js Docker network=none içinde çalışmalı. package.json scripts yasak.",
      projectId: project.id,
      assigneeId: "tester",
      parentTaskId: parent.id,
      priority: "high",
      status: "planned",
      source: "real",
      origin,
      idempotencyKey: `tp5e006-retry-tester-${stamp}`,
      executionPolicy: "AUTO",
      executionKind: "real_ai_pending",
      acceptanceCriteria:
        "sandbox_command docker node --test exit=0 + stdoutDigest; model iddiası tek başına done yapmaz.",
    },
  });

  if (developerTaskRow.id !== developerId || testerTaskRow.id !== testerId) {
    throw new Error("task_id_mismatch");
  }

  const { executeOneLocalAgentTask } = await import("../src/ai/local-agent-execution.js");

  const developerResult = await executeOneLocalAgentTask(developerId, "local");
  const testerResult = await executeOneLocalAgentTask(testerId, "local");

  const developerTask = await prisma.task.findUnique({ where: { id: developerId } });
  const testerTask = await prisma.task.findUnique({ where: { id: testerId } });
  const messages = await prisma.agentMessage.findMany({
    where: {
      OR: [{ taskId: developerId }, { taskId: testerId }, { parentTaskId: parentId }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromAgentId: true,
      toAgentId: true,
      kind: true,
      summary: true,
      taskId: true,
      createdAt: true,
    },
  });

  // Fixture source unchanged
  const fixtureDemo = readFileSync(path.join(fixtureRoot, "src", "demo.js"), "utf8");
  const fixtureUnchanged = fixtureDemo.includes("return a;") && !fixtureDemo.includes("return a + b;");

  // Parse evidence from executionResult
  let developerEvidence: unknown = null;
  let testerEvidence: unknown = null;
  try {
    developerEvidence = developerTask?.executionResult
      ? JSON.parse(developerTask.executionResult)
      : null;
  } catch {
    developerEvidence = null;
  }
  try {
    testerEvidence = testerTask?.executionResult ? JSON.parse(testerTask.executionResult) : null;
  } catch {
    testerEvidence = null;
  }

  await shutdownModes();
  resetEnvCacheForTests();
  const envAfter = getEnv();
  const modesAfter = {
    localAgent: envAfter.LOCAL_AGENT_EXECUTION_MODE,
    repoTools: envAfter.AGENT_REPO_TOOLS_MODE,
    sandbox: envAfter.AGENT_SANDBOX_MODE,
    scheduler: envAfter.SCHEDULER_AI_CEO_MODE,
    cloudLive: envAfter.CLOUD_AGENT_LIVE_ENABLED,
    cursorMode: envAfter.CURSOR_CLOUD_MODE,
  };

  clearTestFixtureBindings();
  // Keep baseline sandbox dirs for OS temp cleanup; fixture root can stay for evidence path note
  rmSync(baselineCopy.sandboxRoot, { recursive: true, force: true });

  const result = {
    taskId: "T-P5E-006-retry",
    wallClockMs: Date.now() - startedAll,
    preflight,
    parentId,
    developerId,
    testerId,
    baselineFail: preflight.baselineFail,
    developerResult,
    testerResult,
    developerTask: {
      id: developerTask?.id,
      status: developerTask?.status,
      model: developerTask?.model,
      executionKind: developerTask?.executionKind,
      blockedReason: developerTask?.blockedReason,
      executionResult: developerEvidence,
    },
    testerTask: {
      id: testerTask?.id,
      status: testerTask?.status,
      model: testerTask?.model,
      executionKind: testerTask?.executionKind,
      blockedReason: testerTask?.blockedReason,
      executionResult: testerEvidence,
    },
    messages,
    fixtureUnchanged,
    fixtureRootHint: path.basename(fixtureRoot),
    modesAfter,
    dockerImage: SANDBOX_DOCKER_IMAGE_REF,
    llmCalls: 2,
    cloudStarted: false,
  };

  writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(OUT_MD, renderMd(result), "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      developerStatus: developerResult.status,
      testerStatus: testerResult.status,
      developerAcceptance: developerResult.acceptanceMet,
      testerAcceptance: testerResult.acceptanceMet,
      modesAfter,
      out: OUT_MD,
    }),
  );

  await disconnectPrisma().catch(() => undefined);
  // leave fixtureRoot for OS temp; optional cleanup
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function shutdownModes() {
  await setEnvKeys({
    LOCAL_AGENT_EXECUTION_MODE: "off",
    AGENT_REPO_TOOLS_MODE: "off",
    AGENT_SANDBOX_MODE: "off",
    SCHEDULER_AI_CEO_MODE: "off",
    CLOUD_AGENT_LIVE_ENABLED: "false",
    CURSOR_CLOUD_MODE: "mock",
    CLOUD_ON_DEMAND_VERIFIED: "false",
    LOCAL_AGENT_EXECUTION_MAX_PER_DAY: "4",
  });
}

function writeBlocked(reason: string, preflight: Record<string, unknown>) {
  const payload = {
    taskId: "T-P5E-006-retry",
    verdict: "BLOCKED",
    reason,
    preflight,
    liveOllamaStarted: false,
    at: new Date().toISOString(),
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(
    OUT_MD,
    `# T-P5E-006-retry — BLOCKED\n\nNeden: \`${reason}\`\n\nCanlı Ollama başlatılmadı.\n\n\`\`\`json\n${JSON.stringify(preflight, null, 2).slice(0, 8000)}\n\`\`\`\n`,
    "utf8",
  );
  console.error(JSON.stringify({ ok: false, blocked: reason }));
  process.exitCode = 2;
}

function renderMd(result: {
  wallClockMs: number;
  baselineFail: unknown;
  developerResult: {
    status: string;
    acceptanceMet: boolean;
    codeChangeApplied: boolean;
    realAiExecution: boolean;
    modelId: string | null;
    durationMs: number | null;
  };
  testerResult: {
    status: string;
    acceptanceMet: boolean;
    realAiExecution: boolean;
    modelId: string | null;
    durationMs: number | null;
  };
  developerTask: { status?: string; executionResult: unknown };
  testerTask: { status?: string; executionResult: unknown };
  messages: Array<{ fromAgentId: string; toAgentId: string; kind: string; summary: string }>;
  fixtureUnchanged: boolean;
  modesAfter: Record<string, unknown>;
  dockerImage: string;
  llmCalls: number;
}): string {
  const devEv = result.developerTask.executionResult as {
    toolEvidence?: Array<{ kind?: string; summary?: string; stdoutDigest?: string; exitCode?: number; command?: string }>;
    work?: { summary?: string };
    sandboxDiffPreview?: string | null;
  } | null;
  const testEv = result.testerTask.executionResult as {
    toolEvidence?: Array<{ kind?: string; summary?: string; stdoutDigest?: string; exitCode?: number; command?: string }>;
  } | null;
  const diff = devEv?.toolEvidence?.find((e) => e.kind === "sandbox_diff");
  const cmd = testEv?.toolEvidence?.find((e) => e.kind === "sandbox_command");

  return `# T-P5E-006-retry — Canlı Docker+Ollama pilot sonucu

**Tarih:** ${new Date().toISOString()}  
**Wall clock:** ${result.wallClockMs} ms  
**LLM çağrıları:** ${result.llmCalls} (Developer + Tester)  
**Image:** \`${result.dockerImage}\`

## Önce başarısız test

\`\`\`json
${JSON.stringify(result.baselineFail, null, 2)}
\`\`\`

## Developer

- status: **${result.developerResult.status}**
- realAi: ${result.developerResult.realAiExecution}
- model: ${result.developerResult.modelId}
- durationMs: ${result.developerResult.durationMs}
- acceptanceMet: ${result.developerResult.acceptanceMet}
- codeChangeApplied: ${result.developerResult.codeChangeApplied}
- sandbox_diff: ${diff?.summary ?? "yok"}
- diff preview: ${(devEv?.sandboxDiffPreview ?? "").slice(0, 800) || "—"}

## Tester

- status: **${result.testerResult.status}**
- realAi: ${result.testerResult.realAiExecution}
- model: ${result.testerResult.modelId}
- durationMs: ${result.testerResult.durationMs}
- acceptanceMet: ${result.testerResult.acceptanceMet}
- command: ${cmd?.command ?? "yok"}
- exitCode: ${cmd?.exitCode ?? "—"}
- digest: ${cmd?.stdoutDigest ?? "—"}

## AgentMessage

${result.messages.map((m) => `- ${m.fromAgentId}→${m.toAgentId} [${m.kind}]: ${m.summary.slice(0, 160)}`).join("\n")}

## Fixture / güvenlik

- Fixture kaynak \`src/demo.js\` değişmedi (yalnızca sandbox): **${result.fixtureUnchanged}**
- Cloud Agent: başlatılmadı
- Subify/Marivo/SynapTech ana kaynak: yazılmadı

## Pilot sonrası modlar

\`\`\`json
${JSON.stringify(result.modesAfter, null, 2)}
\`\`\`

Kanıt JSON: \`reports/qa/faz-5e-tp5e006-retry-live-result.json\`
`;
}

main().catch(async (err) => {
  console.error(err);
  try {
    await shutdownModes();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
