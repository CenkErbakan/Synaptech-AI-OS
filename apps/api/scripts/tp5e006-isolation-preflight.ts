/**
 * T-P5E-006 izolasyon / güvenlik ön kontrolü.
 * Canlı test çalıştırmaz; kanıt JSON yazar.
 */
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createHash } from "node:crypto";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const OUT = path.resolve(
  process.cwd(),
  "../../reports/qa/faz-5e-tp5e006-isolation-preflight.json",
);

const BOUND = {
  "acceptance-verifier.ts":
    "7BC4B9919A9987BD672A7ABBFAF828F1CCCC896A122D91F16E81BFECB053A0EE",
  "sandbox-patch.ts": "CEA5E340F63DE247F355B9CFDE78EE70CCC053B2ED9AAA7B7C413CD6B8EBC8E8",
  "sandbox-runner.ts": "9582CB07906B3781EBACB4191AA0EB2EA2DCA37F58B8603CD01FBEDCBD385EAD",
  "local-agent-execution.ts":
    "387E81DFB5D80213E254743AB2025F5C2DFFB1729A51D8BB5E18D767939FFB7E",
} as const;

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex").toUpperCase();
}

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function main() {
  const { resetEnvCacheForTests, getEnv, repoRoot } = await import("../src/lib/env.js");
  resetEnvCacheForTests();
  const env = getEnv();
  const root = repoRoot();

  const files = {
    "acceptance-verifier.ts": path.resolve(process.cwd(), "src/ai/repo/acceptance-verifier.ts"),
    "sandbox-patch.ts": path.resolve(process.cwd(), "src/ai/repo/sandbox-patch.ts"),
    "sandbox-runner.ts": path.resolve(process.cwd(), "src/ai/repo/sandbox-runner.ts"),
    "local-agent-execution.ts": path.resolve(process.cwd(), "src/ai/local-agent-execution.ts"),
  };
  const shaCheck = Object.fromEntries(
    Object.entries(files).map(([name, p]) => {
      const actual = sha256File(p);
      return [name, { actual, expected: BOUND[name as keyof typeof BOUND], match: actual === BOUND[name as keyof typeof BOUND] }];
    }),
  );

  const { getKillSwitch } = await import("../src/engines/kill-switch.js");
  const kill = await getKillSwitch();

  let ollamaOk = false;
  let ollamaModels: string[] = [];
  let ollamaError: string | null = null;
  try {
    const base = env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434";
    const res = await fetch(`${base.replace(/\/$/, "")}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    ollamaModels = (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    ollamaOk = ollamaModels.some((n) => n === env.LOCAL_LLM_MODEL || n.startsWith("qwen2.5:14b"));
  } catch (e) {
    ollamaError = e instanceof Error ? e.message : String(e);
  }

  const { createIsolatedSandboxDir, materializeSandboxCopy, SANDBOX_COMMAND_ALLOWLIST } =
    await import("../src/ai/repo/sandbox-runner.js");

  const probeDir = mkdtempSync(path.join(os.tmpdir(), "synaptech-tp5e006-probe-"));
  // minimal fixture source for path proof only (no test execution here)
  const { writeFileSync: w, mkdirSync } = await import("node:fs");
  mkdirSync(path.join(probeDir, "src"), { recursive: true });
  w(path.join(probeDir, "package.json"), '{"name":"probe","private":true}\n');
  w(path.join(probeDir, "src", "x.js"), "export const x=1\n");
  const copy = materializeSandboxCopy(probeDir, { maxFiles: 20 });
  const sandboxRoot = copy.sandboxRoot;
  const tmp = os.tmpdir();

  const forbiddenRoots = [
    root,
    path.resolve("C:/Users/cenke/Desktop/Projeler/Subify"),
    path.resolve("C:/Users/cenke/Desktop/Projeler/Marivo"),
    path.resolve("C:/Users/cenke/Desktop/Projeler/SynapTech"),
  ];

  const pathIsolation = {
    sandboxRoot,
    underOsTmp: isUnder(sandboxRoot, tmp),
    overlapsForbidden: forbiddenRoots
      .filter((p) => existsSync(p))
      .map((p) => ({ root: p, overlaps: isUnder(sandboxRoot, p) || isUnder(p, sandboxRoot) })),
  };

  // Isolation capabilities of current runner (honest)
  const isolation = {
    fileSystem: {
      patchPathJail: true,
      secretsExcludedFromCopy: true,
      childProcessChrootOrContainer: false,
      childCanWriteOutsideSandbox: true, // OS user permissions; not jailed
      proven: false,
      note: "Patch jail var; spawn edilen süreç chroot/container değil — sandbox dışı yazabilir.",
    },
    process: {
      shellFalse: true,
      allowListOnly: true,
      timeoutKill: true,
      jobObjectOrContainer: false,
      proven: false,
      note: "Allow-list + timeout var; tam süreç izolasyonu (container/job) yok.",
    },
    network: {
      blocked: false,
      proven: false,
      note: "Child env'de proxy yok; ağ engeli uygulanmıyor. node/npm dışarı çıkabilir.",
    },
    scriptRisk: {
      packageJsonScriptsCanBeArbitrary: true,
      note: "npm_test/pnpm_test proje scripts üzerinden keyfi komut çalıştırabilir.",
    },
  };

  const liveTestAllowed =
    pathIsolation.underOsTmp &&
    pathIsolation.overlapsForbidden.every((o) => !o.overlaps) &&
    isolation.fileSystem.proven &&
    isolation.process.proven &&
    isolation.network.proven;

  const blocks: string[] = [];
  if (!Object.values(shaCheck).every((s) => s.match)) blocks.push("sha_mismatch");
  if (kill.enabled) blocks.push("kill_switch_enabled");
  if (env.CLOUD_AGENT_LIVE_ENABLED) blocks.push("cloud_live");
  if (env.CURSOR_CLOUD_MODE === "live") blocks.push("cursor_cloud_live");
  if (!ollamaOk) blocks.push("ollama_unavailable");
  if (!liveTestAllowed) blocks.push("sandbox_isolation_unproven");

  const report = {
    taskId: "T-P5E-006",
    at: new Date().toISOString(),
    shaCheck,
    killEnabled: kill.enabled,
    env: {
      AGENT_REPO_TOOLS_MODE: env.AGENT_REPO_TOOLS_MODE,
      AGENT_SANDBOX_MODE: env.AGENT_SANDBOX_MODE,
      LOCAL_AGENT_EXECUTION_MODE: env.LOCAL_AGENT_EXECUTION_MODE,
      SCHEDULER_AI_CEO_MODE: env.SCHEDULER_AI_CEO_MODE,
      CLOUD_AGENT_LIVE_ENABLED: env.CLOUD_AGENT_LIVE_ENABLED,
      CURSOR_CLOUD_MODE: env.CURSOR_CLOUD_MODE,
      CLOUD_ON_DEMAND_VERIFIED: env.CLOUD_ON_DEMAND_VERIFIED,
      MODEL_PROVIDER: env.MODEL_PROVIDER,
      LOCAL_LLM_MODEL: env.LOCAL_LLM_MODEL,
    },
    ollamaOk,
    ollamaModels,
    ollamaError,
    pathIsolation,
    isolation,
    allowlist: SANDBOX_COMMAND_ALLOWLIST.map((c) => c.id),
    liveTestAllowed,
    blocks,
    verdict: blocks.length ? "BLOCKED" : "READY",
  };

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ verdict: report.verdict, blocks, out: OUT, liveTestAllowed }, null, 2));

  const { disconnectPrisma } = await import("../src/db/prisma.js");
  await disconnectPrisma().catch(() => undefined);
  if (blocks.length) process.exit(2);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
