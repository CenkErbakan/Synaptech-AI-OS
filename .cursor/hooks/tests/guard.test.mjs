import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.resolve(HERE, "..");
const GUARD = path.join(HOOKS_DIR, "guard.mjs");
const REAL_POLICY = path.join(HOOKS_DIR, "policy.json");
const REPO_ROOT = path.resolve(HOOKS_DIR, "..", "..");

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "synaptech-guard-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, ".cursor", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "config", "kill-switch.json"),
    JSON.stringify({ enabled: false }),
    "utf8",
  );
  fs.copyFileSync(REAL_POLICY, path.join(root, ".cursor", "hooks", "policy.json"));
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/agent/test\n");
  return root;
}

function setKillSwitch(root, enabled) {
  fs.writeFileSync(
    path.join(root, "config", "kill-switch.json"),
    JSON.stringify({ enabled, reason: enabled ? "test" : null }),
    "utf8",
  );
}

function setBranch(root, branch) {
  fs.writeFileSync(path.join(root, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
}

function runGuard(event, payload, { root, observe = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = [GUARD, event];
    if (observe) args.push("--observe");
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SYNAPTECH_GUARD_ROOT: root || REPO_ROOT,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let json;
      try {
        json = JSON.parse(stdout.trim() || "{}");
      } catch (err) {
        reject(new Error(`Geçersiz JSON (code=${code}): ${stdout}\nstderr=${stderr}\n${err}`));
        return;
      }
      resolve({ code, json, stdout, stderr });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

test("kill switch blocks non-read tools", async () => {
  const root = mkFixture();
  setKillSwitch(root, true);
  const denied = await runGuard(
    "preToolUse",
    { tool_name: "Write", tool_input: { path: "tasks/x.md", contents: "x" } },
    { root },
  );
  assert.equal(denied.code, 0);
  assert.equal(denied.json.permission, "deny");
  assert.match(denied.json.user_message || "", /kill switch/i);

  const allowed = await runGuard(
    "preToolUse",
    { tool_name: "Read", tool_input: { path: "AGENTS.md" } },
    { root },
  );
  assert.equal(allowed.json.permission, "allow");

  const sub = await runGuard(
    "subagentStart",
    {
      conversation_id: "c1",
      subagent_id: "s1",
      subagent_type: "explore",
      task: "x",
      subagent_model: "composer-2.5",
    },
    { root },
  );
  assert.equal(sub.json.permission, "deny");
});

test("git push denied", async () => {
  const root = mkFixture();
  const res = await runGuard(
    "beforeShellExecution",
    { command: "git push origin agent/foo" },
    { root },
  );
  assert.equal(res.code, 0);
  assert.equal(res.json.permission, "deny");
  assert.match(res.json.user_message || "", /push/i);
});

test("main/master commit denied", async () => {
  const root = mkFixture();
  setBranch(root, "main");
  const res = await runGuard(
    "beforeShellExecution",
    { command: "git commit -m \"test\"" },
    { root },
  );
  assert.equal(res.json.permission, "deny");
  assert.match(res.json.user_message || "", /main|master/i);

  setBranch(root, "master");
  const res2 = await runGuard(
    "beforeShellExecution",
    { command: "git merge feature" },
    { root },
  );
  assert.equal(res2.json.permission, "deny");
});


test("foreign workspace_roots still allows in-repo writes", async () => {
  const root = mkFixture();
  const allow = await runGuard(
    "preToolUse",
    {
      tool_name: "Write",
      tool_input: { path: "reports/qa/tmp.txt", contents: "ok" },
      workspace_roots: ["C:\\Users\\cenke\\.cursor\\projects\\unrelated"],
    },
    { root },
  );
  assert.equal(allow.json.permission, "allow");

  const deny = await runGuard(
    "preToolUse",
    {
      tool_name: "Write",
      tool_input: { path: "AGENTS.md", contents: "x" },
      workspace_roots: ["C:\\Users\\cenke\\.cursor\\projects\\unrelated"],
    },
    { root },
  );
  assert.equal(deny.json.permission, "deny");
  assert.match(deny.json.user_message || "", /korumalı/i);
});

test("protected path write denied", async () => {
  const root = mkFixture();
  const res = await runGuard(
    "preToolUse",
    {
      tool_name: "Write",
      tool_input: { path: ".cursor/rules/00-security-baseline.mdc", contents: "x" },
      workspace_roots: [root],
    },
    { root },
  );
  assert.equal(res.json.permission, "deny");
  assert.match(res.json.user_message || "", /korumalı/i);

  const cfg = await runGuard(
    "preToolUse",
    {
      tool_name: "StrReplace",
      tool_input: { path: "config/kill-switch.json", old_string: "a", new_string: "b" },
      workspace_roots: [root],
    },
    { root },
  );
  assert.equal(cfg.json.permission, "deny");
});

test("concurrent subagent slot limit 2", async () => {
  const root = mkFixture();
  const base = {
    conversation_id: "conv-limit",
    subagent_type: "explore",
    task: "t",
    subagent_model: "composer-2.5",
  };
  const a = await runGuard("subagentStart", { ...base, subagent_id: "a", task: "t1" }, { root });
  const b = await runGuard("subagentStart", { ...base, subagent_id: "b", task: "t2" }, { root });
  const c = await runGuard("subagentStart", { ...base, subagent_id: "c", task: "t3" }, { root });
  assert.equal(a.json.permission, "allow");
  assert.equal(b.json.permission, "allow");
  assert.equal(c.json.permission, "deny");
  assert.match(c.json.user_message || "", /eşzamanlı|sınır/i);

  await runGuard(
    "subagentStop",
    { subagent_type: "explore", task: "t1", status: "completed" },
    { root },
  );
  const d = await runGuard("subagentStart", { ...base, subagent_id: "d", task: "t4" }, { root });
  assert.equal(d.json.permission, "allow");
});

test("observe mode never denies", async () => {
  const root = mkFixture();
  setKillSwitch(root, true);
  setBranch(root, "main");

  const cases = [
    ["preToolUse", { tool_name: "Write", tool_input: { path: "config/x.json", contents: "x" } }],
    ["beforeShellExecution", { command: "git push origin main" }],
    ["beforeShellExecution", { command: "git commit -m x" }],
    [
      "subagentStart",
      {
        conversation_id: "obs",
        subagent_id: "o1",
        subagent_type: "explore",
        task: "x",
        subagent_model: "claude-fable-5-2-high",
      },
    ],
    ["beforeSubmitPrompt", { prompt: "api_key=sk-abcdefghijklmnopqrstuvwxyz012345" }],
  ];

  for (const [event, payload] of cases) {
    const res = await runGuard(event, payload, { root, observe: true });
    assert.equal(res.code, 0, event);
    if (event === "beforeSubmitPrompt") {
      assert.equal(res.json.continue, true, event);
    } else {
      assert.equal(res.json.permission, "allow", event);
    }
  }
});

test("policy numbers match budget-policy yaml concurrency", () => {
  const policy = JSON.parse(fs.readFileSync(REAL_POLICY, "utf8"));
  const yaml = fs.readFileSync(path.join(REPO_ROOT, "config", "budget-policy.yaml"), "utf8");

  const maxConcurrent = Number(yaml.match(/max_concurrent_subagents:\s*(\d+)/)?.[1]);
  const ttl = Number(yaml.match(/subagent_slot_ttl_minutes:\s*(\d+)/)?.[1]);
  const maxLaunches = Number(yaml.match(/max_subagent_launches_per_conversation:\s*(\d+)/)?.[1]);

  assert.equal(maxConcurrent, 2);
  assert.equal(ttl, 30);
  assert.equal(maxLaunches, 12);

  assert.equal(policy.subagents.maxConcurrent, maxConcurrent);
  assert.equal(policy.subagents.slotTtlMinutes, ttl);
  assert.equal(policy.subagents.maxLaunchesPerConversation, maxLaunches);

  const denied = yaml.match(/denied_subagent_model_patterns:\s*\n((?:\s+-\s+.+\n)+)/)?.[1] || "";
  const patterns = [...denied.matchAll(/-\s*(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(policy.subagents.deniedModelPatterns, patterns);
});
