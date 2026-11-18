/**
 * Sabit parametreli Docker sandbox runner.
 * Model / ajan Docker bayrağı, mount veya komut seçemez — yalnızca backend.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Tag + digest pin — pull sonrası doğrulanır. */
export const SANDBOX_DOCKER_IMAGE_NAME = "node:22-bookworm-slim";
export const SANDBOX_DOCKER_IMAGE_DIGEST =
  "sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee";

export const SANDBOX_DOCKER_IMAGE_REF = `${SANDBOX_DOCKER_IMAGE_NAME}@${SANDBOX_DOCKER_IMAGE_DIGEST}`;

/** İzole tester için izinli göreli test dosyaları (sabit allow-list). */
export const ISOLATED_ALLOWED_TEST_FILES = ["test/demo.test.js"] as const;

export type DockerProbeResult = {
  ok: boolean;
  clientVersion: string | null;
  serverVersion: string | null;
  context: string | null;
  error: string | null;
};

export type ContainerIsolationEvidence = {
  networkMode: string;
  privileged: boolean;
  readonlyRootfs: boolean;
  user: string;
  capDrop: string[];
  securityOpt: string[];
  pidsLimit: number | null;
  memoryBytes: number | null;
  image: string;
  imageId: string | null;
  mounts: Array<{ destination: string; rw: boolean }>;
};

export type IsolatedContainerResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  containerName: string;
  imageRef: string;
  isolation: ContainerIsolationEvidence | null;
  dockerUnavailable?: boolean;
  blockedReason?: string;
};

function runDocker(
  args: string[],
  opts?: { timeoutMs?: number; allowFail?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  return new Promise((resolve) => {
    const child = spawn("docker", args, {
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        // Agent secrets / owner token Docker'a sızmasın
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, stdout, stderr: `${stderr}\ndocker_timeout` });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d).slice(0, 50_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d).slice(0, 50_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function probeDockerEngine(): Promise<DockerProbeResult> {
  const ver = await runDocker(["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], {
    timeoutMs: 15_000,
  });
  if (ver.code !== 0) {
    return {
      ok: false,
      clientVersion: null,
      serverVersion: null,
      context: null,
      error: (ver.stderr || ver.stdout || "docker_unavailable").slice(0, 500),
    };
  }
  const [clientVersion, serverVersion] = ver.stdout.trim().split("|");
  const ctx = await runDocker(["context", "show"], { timeoutMs: 10_000 });
  return {
    ok: Boolean(serverVersion),
    clientVersion: clientVersion || null,
    serverVersion: serverVersion || null,
    context: ctx.code === 0 ? ctx.stdout.trim() : null,
    error: serverVersion ? null : "docker_engine_not_running",
  };
}

export async function ensurePinnedSandboxImage(): Promise<{
  ok: boolean;
  imageRef: string;
  digest: string | null;
  error: string | null;
}> {
  const inspect = await runDocker(
    ["image", "inspect", SANDBOX_DOCKER_IMAGE_REF, "--format", "{{.Id}}"],
    { timeoutMs: 20_000 },
  );
  if (inspect.code === 0 && inspect.stdout.trim()) {
    return {
      ok: true,
      imageRef: SANDBOX_DOCKER_IMAGE_REF,
      digest: SANDBOX_DOCKER_IMAGE_DIGEST,
      error: null,
    };
  }
  // Tag ile local varsa digest'i doğrula
  const byTag = await runDocker(
    [
      "image",
      "inspect",
      SANDBOX_DOCKER_IMAGE_NAME,
      "--format",
      "{{index .RepoDigests 0}}|{{.Id}}",
    ],
    { timeoutMs: 20_000 },
  );
  if (byTag.code === 0) {
    const [repoDigest] = byTag.stdout.trim().split("|");
    if (repoDigest?.endsWith(SANDBOX_DOCKER_IMAGE_DIGEST.replace("sha256:", ""))) {
      return {
        ok: true,
        imageRef: SANDBOX_DOCKER_IMAGE_REF,
        digest: SANDBOX_DOCKER_IMAGE_DIGEST,
        error: null,
      };
    }
    if (repoDigest?.includes(SANDBOX_DOCKER_IMAGE_DIGEST)) {
      return {
        ok: true,
        imageRef: SANDBOX_DOCKER_IMAGE_REF,
        digest: SANDBOX_DOCKER_IMAGE_DIGEST,
        error: null,
      };
    }
  }
  return {
    ok: false,
    imageRef: SANDBOX_DOCKER_IMAGE_REF,
    digest: null,
    error: `pinned_image_missing:${SANDBOX_DOCKER_IMAGE_REF}`,
  };
}

export function assertAllowedIsolatedTestFile(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/^[a-zA-Z0-9._/-]+$/.test(normalized) || normalized.includes("..")) {
    throw new Error(`test_path_invalid:${relPath}`);
  }
  if (!(ISOLATED_ALLOWED_TEST_FILES as readonly string[]).includes(normalized)) {
    throw new Error(`test_path_not_allowlisted:${normalized}`);
  }
  return normalized;
}

export function resolveAllowedTestFileInSandbox(sandboxRoot: string): string | null {
  for (const rel of ISOLATED_ALLOWED_TEST_FILES) {
    if (fs.existsSync(path.join(sandboxRoot, rel))) return rel;
  }
  return null;
}

function buildDockerRunArgs(input: {
  containerName: string;
  hostWorkDir: string;
  imageRef: string;
  nodeArgs: string[];
  memoryMb: number;
  cpus: string;
  pidsLimit: number;
}): string[] {
  // Host yolu yalnızca sabit sandbox temp — Docker Desktop Windows path kabul eder.
  const host = path.resolve(input.hostWorkDir);
  return [
    "run",
    "--rm",
    "--name",
    input.containerName,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(input.pidsLimit),
    "--memory",
    `${input.memoryMb}m`,
    "--cpus",
    input.cpus,
    "--workdir",
    "/work",
    "--mount",
    `type=bind,src=${host},dst=/work,ro=true`,
    "--entrypoint",
    "node",
    input.imageRef,
    ...input.nodeArgs,
  ];
}

async function inspectContainerOnce(
  name: string,
): Promise<ContainerIsolationEvidence | null> {
  const fmt = [
    "{{.HostConfig.NetworkMode}}",
    "{{.HostConfig.Privileged}}",
    "{{.HostConfig.ReadonlyRootfs}}",
    "{{.Config.User}}",
    "{{json .HostConfig.CapDrop}}",
    "{{json .HostConfig.SecurityOpt}}",
    "{{.HostConfig.PidsLimit}}",
    "{{.HostConfig.Memory}}",
    "{{.Config.Image}}",
    "{{.Image}}",
    "{{json .Mounts}}",
  ].join("|");
  const res = await runDocker(["inspect", "-f", fmt, name], { timeoutMs: 10_000 });
  if (res.code !== 0) return null;
  const parts = res.stdout.trim().split("|");
  if (parts.length < 11) return null;
  let mounts: Array<{ destination: string; rw: boolean }> = [];
  try {
    const raw = JSON.parse(parts[10] || "[]") as Array<{
      Destination?: string;
      RW?: boolean;
    }>;
    mounts = raw.map((m) => ({
      destination: m.Destination ?? "",
      rw: Boolean(m.RW),
    }));
  } catch {
    mounts = [];
  }
  let capDrop: string[] = [];
  try {
    capDrop = JSON.parse(parts[4] || "[]") as string[];
  } catch {
    capDrop = [];
  }
  let securityOpt: string[] = [];
  try {
    securityOpt = (JSON.parse(parts[5] || "null") as string[] | null) ?? [];
  } catch {
    securityOpt = [];
  }
  return {
    networkMode: parts[0] ?? "unknown",
    privileged: parts[1] === "true",
    readonlyRootfs: parts[2] === "true",
    user: parts[3] ?? "",
    capDrop,
    securityOpt,
    pidsLimit: parts[6] && parts[6] !== "<nil>" ? Number(parts[6]) : null,
    memoryBytes: parts[7] && parts[7] !== "0" ? Number(parts[7]) : null,
    image: parts[8] ?? "",
    imageId: parts[9] ?? null,
    mounts,
  };
}

/**
 * Sabit `node --test <allow-list dosya>` — host spawn yok, Docker yoksa hata.
 */
export async function runIsolatedNodeTest(input: {
  sandboxRoot: string;
  testRelPath: string;
  timeoutMs?: number;
  memoryMb?: number;
  cpus?: string;
  pidsLimit?: number;
}): Promise<IsolatedContainerResult> {
  const probe = await probeDockerEngine();
  if (!probe.ok) {
    return {
      ok: false,
      exitCode: 127,
      stdout: "",
      stderr: probe.error ?? "docker_unavailable",
      durationMs: 0,
      containerName: "",
      imageRef: SANDBOX_DOCKER_IMAGE_REF,
      isolation: null,
      dockerUnavailable: true,
      blockedReason: "docker_unavailable_no_host_fallback",
    };
  }

  const image = await ensurePinnedSandboxImage();
  if (!image.ok) {
    return {
      ok: false,
      exitCode: 127,
      stdout: "",
      stderr: image.error ?? "image_missing",
      durationMs: 0,
      containerName: "",
      imageRef: SANDBOX_DOCKER_IMAGE_REF,
      isolation: null,
      dockerUnavailable: false,
      blockedReason: "pinned_image_missing",
    };
  }

  const testRel = assertAllowedIsolatedTestFile(input.testRelPath);
  const absTest = path.join(input.sandboxRoot, testRel);
  if (!fs.existsSync(absTest)) {
    return {
      ok: false,
      exitCode: 2,
      stdout: "",
      stderr: `test_file_missing:${testRel}`,
      durationMs: 0,
      containerName: "",
      imageRef: image.imageRef,
      isolation: null,
      blockedReason: "test_file_missing",
    };
  }

  const containerName = `synaptech-sbx-${randomUUID().slice(0, 8)}`;
  const timeoutMs = input.timeoutMs ?? 60_000;
  const nodeArgs = ["--test", `/work/${testRel}`];
  const args = buildDockerRunArgs({
    containerName,
    hostWorkDir: input.sandboxRoot,
    imageRef: image.imageRef,
    nodeArgs,
    memoryMb: input.memoryMb ?? 256,
    cpus: input.cpus ?? "0.5",
    pidsLimit: input.pidsLimit ?? 64,
  });

  // Yasak bayraklar asla eklenmez (savunma: argüman listesi sabit üreticiden).
  const forbidden = [
    "--privileged",
    "--pid=host",
    "--network=host",
    "docker.sock",
    "/var/run/docker.sock",
  ];
  const joined = args.join(" ");
  for (const f of forbidden) {
    if (joined.includes(f)) {
      return {
        ok: false,
        exitCode: 126,
        stdout: "",
        stderr: `forbidden_docker_flag:${f}`,
        durationMs: 0,
        containerName,
        imageRef: image.imageRef,
        isolation: null,
        blockedReason: "forbidden_docker_flag",
      };
    }
  }

  const started = Date.now();
  // Paralel inspect için detach+wait yerine run --rm; izolasyon doğrulama ayrı probe container ile.
  const run = await runDocker(args, { timeoutMs: timeoutMs + 5_000 });
  const durationMs = Date.now() - started;

  // Timeout'ta container kalıntısını temizle
  if (run.code === 124) {
    await runDocker(["rm", "-f", containerName], { timeoutMs: 10_000 });
  }

  return {
    ok: run.code === 0,
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
    durationMs,
    containerName,
    imageRef: image.imageRef,
    isolation: null,
  };
}

/**
 * İzolasyon kanıtı için kısa ömürlü probe container (test komutu çalıştırmaz).
 * sleep ile inspect edilir, sonra zorla silinir.
 */
export async function probeContainerIsolationConfig(input: {
  sandboxRoot: string;
}): Promise<{
  ok: boolean;
  isolation: ContainerIsolationEvidence | null;
  error: string | null;
}> {
  const probe = await probeDockerEngine();
  if (!probe.ok) {
    return { ok: false, isolation: null, error: probe.error };
  }
  const image = await ensurePinnedSandboxImage();
  if (!image.ok) {
    return { ok: false, isolation: null, error: image.error };
  }

  const name = `synaptech-probe-${randomUUID().slice(0, 8)}`;
  const host = path.resolve(input.sandboxRoot);
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=16m",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "32",
    "--memory",
    "64m",
    "--cpus",
    "0.25",
    "--workdir",
    "/work",
    "--mount",
    `type=bind,src=${host},dst=/work,ro=true`,
    "--entrypoint",
    "sleep",
    image.imageRef,
    "8",
  ];

  try {
    const created = await runDocker(args, { timeoutMs: 30_000 });
    if (created.code !== 0) {
      return {
        ok: false,
        isolation: null,
        error: (created.stderr || created.stdout).slice(0, 400),
      };
    }
    // Kısa bekleme — inspect hazır olsun
    await new Promise((r) => setTimeout(r, 400));
    const isolation = await inspectContainerOnce(name);
    return {
      ok: Boolean(isolation),
      isolation,
      error: isolation ? null : "inspect_failed",
    };
  } finally {
    await runDocker(["rm", "-f", name], { timeoutMs: 15_000 });
  }
}

/** Ağ engeli kanıtı: container içinden TCP denemesi (network=none). */
export async function proveNetworkBlocked(sandboxRoot: string): Promise<{
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const image = await ensurePinnedSandboxImage();
  if (!image.ok) {
    return { ok: false, exitCode: 127, stdout: "", stderr: image.error ?? "image" };
  }
  const name = `synaptech-net-${randomUUID().slice(0, 8)}`;
  const host = path.resolve(sandboxRoot);
  // node -e fetch; network=none → ENOTFOUND / fail
  const script =
    "fetch('http://1.1.1.1/',{signal:AbortSignal.timeout(3000)}).then(r=>console.log('REACHED',r.status)).catch(e=>{console.error('BLOCKED',e.cause?.code||e.code||e.message);process.exit(2)})";
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=16m",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "64m",
    "--cpus",
    "0.25",
    "--pids-limit",
    "32",
    "--mount",
    `type=bind,src=${host},dst=/work,ro=true`,
    "--entrypoint",
    "node",
    image.imageRef,
    "-e",
    script,
  ];
  const run = await runDocker(args, { timeoutMs: 20_000 });
  const blocked =
    run.code !== 0 &&
    (run.stderr.includes("BLOCKED") ||
      run.stdout.includes("BLOCKED") ||
      /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(run.stderr + run.stdout));
  return {
    ok: blocked && !/REACHED/.test(run.stdout),
    exitCode: run.code,
    stdout: run.stdout.slice(0, 2000),
    stderr: run.stderr.slice(0, 2000),
  };
}

/**
 * Host / Docker socket sızıntısı engeli.
 * Container OS dosyaları (/etc/passwd) sızıntı sayılmaz; docker.sock, /host, /mnt/c yasak.
 */
export async function proveHostFsBlocked(sandboxRoot: string): Promise<{
  ok: boolean;
  details: string;
}> {
  const image = await ensurePinnedSandboxImage();
  if (!image.ok) {
    return { ok: false, details: image.error ?? "image" };
  }
  const name = `synaptech-fs-${randomUUID().slice(0, 8)}`;
  const host = path.resolve(sandboxRoot);
  // Host'ta sandbox dışı canary — mount edilmemeli
  const canary = path.join(os.tmpdir(), `synaptech-canary-${randomUUID().slice(0, 8)}.secret`);
  fs.writeFileSync(canary, "HOST_SECRET_CANARY\n", "utf8");
  const script = [
    "const fs=require('fs');",
    // Container root (/) varlığı sızıntı değil; host mount / docker.sock aranır.
    "const paths=['/var/run/docker.sock','/run/docker.sock','/host','/mnt/host','/mnt/c/Users','/run/desktop/mnt/host'];",
    "let leaked=false;",
    "for (const p of paths){try{if(fs.existsSync(p)){console.log('LEAK',p);leaked=true;}}catch(e){console.log('DENY',p)}}",
    "try{const uid=process.getuid();console.log('UID',uid);if(uid===0){console.log('LEAK root');leaked=true;}}catch(e){}",
    "process.exit(leaked?1:2);",
  ].join("");
  try {
    const args = [
      "run",
      "--rm",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=16m",
      "--user",
      "1000:1000",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "64m",
      "--cpus",
      "0.25",
      "--pids-limit",
      "32",
      "--mount",
      `type=bind,src=${host},dst=/work,ro=true`,
      "--entrypoint",
      "node",
      image.imageRef,
      "-e",
      script,
    ];
    const run = await runDocker(args, { timeoutMs: 20_000 });
    const leaked = /LEAK/.test(run.stdout);
    const canaryIntact = fs.readFileSync(canary, "utf8").includes("HOST_SECRET_CANARY");
    return {
      ok: !leaked && run.code === 2 && canaryIntact,
      details: `code=${run.code} out=${run.stdout.slice(0, 500)} err=${run.stderr.slice(0, 300)} canary=${canaryIntact}`,
    };
  } finally {
    fs.rmSync(canary, { force: true });
  }
}

export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
