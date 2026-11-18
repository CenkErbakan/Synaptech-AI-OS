#!/usr/bin/env node
/**
 * SynapTech AI OS — Cursor guard (sıfır bağımlılık, Node ESM).
 * Kullanım: node .cursor/hooks/guard.mjs <event> [--observe]
 * stdin: JSON (Windows'ta PowerShell borusu). stdout: her zaman geçerli JSON. exit 0.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.SYNAPTECH_GUARD_ROOT
  ? path.resolve(process.env.SYNAPTECH_GUARD_ROOT)
  : path.resolve(SCRIPT_DIR, "..", "..");

const READ_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "SemanticSearch",
  "ReadLints",
  "GetDynamicTools",
  "AwaitShell",
]);

const WRITE_TOOLS = new Set(["Write", "Delete", "StrReplace", "EditNotebook"]);

const PROMPT_SECRET_RE =
  /(?:api[_-]?key|apikey|secret[_-]?key|private[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|credentials)\s*[:=]\s*['"]?[^\s'"]{8,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|sk-[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{20,}|AIza[0-9A-Za-z_-]{20,}/i;

const MASK_RE =
  /(?:sk-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{10,}|gho_[a-zA-Z0-9]{10,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AIza[0-9A-Za-z_-]{10,}|(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[^\s'"]{6,})/gi;

function loadPolicy() {
  const p = path.join(SCRIPT_DIR, "policy.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const raw = chunks.join("").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ __parseError: true });
      }
    });
    if (process.stdin.isTTY) resolve({});
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mask(text) {
  if (text == null) return text;
  return String(text).replace(MASK_RE, "[REDACTED]");
}

function todayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function writeAudit(policy, entry) {
  try {
    const dir = path.join(REPO_ROOT, policy.auditDir);
    ensureDir(dir);
    const line = JSON.stringify({ v: 1, ts: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFileSync(path.join(dir, `${todayStamp()}.jsonl`), line, "utf8");
  } catch {
    /* audit asla guard'ı düşürmez */
  }
}

function isKillSwitchOn(policy) {
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, policy.killSwitchFile), "utf8");
    return JSON.parse(raw).enabled === true;
  } catch {
    return false;
  }
}

function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

function globToRegExp(glob) {
  const g = normPath(glob);
  let re = "^";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      re += ".*";
      i++;
      if (g[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (".+^$()[]{}|\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  re += "$";
  return new RegExp(re, "i");
}

function matchAny(filePath, patterns) {
  const n = normPath(filePath);
  const base = path.posix.basename(n);
  return patterns.some((pat) => {
    const re = globToRegExp(pat);
    return re.test(n) || re.test(base) || (pat.includes("**/") && re.test(n));
  });
}

function isSecretPath(policy, filePath) {
  if (matchAny(filePath, policy.secretPathExceptions || [])) return false;
  return matchAny(filePath, policy.secretPaths || []);
}

function isProtectedPath(policy, filePath) {
  const n = normPath(filePath);
  return (policy.protectedPaths || []).some((pat) => {
    if (pat.endsWith("/**")) {
      const prefix = pat.slice(0, -3);
      return n === prefix || n.startsWith(prefix + "/");
    }
    return normPath(pat) === n || matchAny(n, [pat]);
  });
}

function workspaceRoots(payload) {
  const roots = new Set([path.resolve(REPO_ROOT)]);
  if (Array.isArray(payload.workspace_roots)) {
    for (const r of payload.workspace_roots) {
      if (r) roots.add(path.resolve(String(r)));
    }
  }
  return [...roots];
}

function resolveInWorkspace(payload, filePath) {
  if (!filePath) return { abs: null, rel: "", outside: false };
  const raw = String(filePath);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(REPO_ROOT, raw);
  const roots = workspaceRoots(payload);
  const outside = !roots.some((root) => {
    const rel = path.relative(root, abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  const rel = path.relative(REPO_ROOT, abs);
  return { abs, rel: outside ? abs : rel, outside };
}

function toolPath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  return (
    toolInput.path ||
    toolInput.target_directory ||
    toolInput.file_path ||
    toolInput.filePath ||
    toolInput.targetFile ||
    ""
  );
}

function currentGitBranch() {
  try {
    const head = fs.readFileSync(path.join(REPO_ROOT, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref: refs/heads/")) return head.slice("ref: refs/heads/".length);
  } catch {
    /* ignore */
  }
  return null;
}

function isDeniedModel(model, patterns) {
  const m = String(model || "").toLowerCase();
  if (!m) return false;
  for (const pat of patterns || []) {
    const p = String(pat).toLowerCase();
    if (p === "fast") {
      if (/\[fast\s*=\s*false\]/.test(m)) continue;
      if (m.includes("fast")) return true;
      continue;
    }
    if (m.includes(p)) return true;
  }
  return false;
}

function taskHash(task) {
  return crypto.createHash("sha256").update(String(task || "")).digest("hex").slice(0, 16);
}

function statePath(policy) {
  return path.join(REPO_ROOT, policy.stateDir, "subagents.json");
}

function loadState(policy) {
  const p = statePath(policy);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { v: 1, active: [], launches: {} };
  }
}

function saveState(policy, state) {
  const p = statePath(policy);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
}

function pruneSlots(state, ttlMinutes, now = Date.now()) {
  const cutoff = now - ttlMinutes * 60_000;
  state.active = (state.active || []).filter((s) => {
    const t = Date.parse(s.startedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
}

function pruneLaunches(state, windowHours, now = Date.now()) {
  const cutoff = now - windowHours * 3600_000;
  const next = {};
  for (const [id, info] of Object.entries(state.launches || {})) {
    const first = Date.parse(info.first);
    if (Number.isFinite(first) && first >= cutoff) next[id] = info;
  }
  state.launches = next;
}

function deny(category, reason, extra = {}) {
  return {
    permission: "deny",
    user_message: reason,
    agent_message: reason,
    category,
    ...extra,
  };
}

function ask(category, reason) {
  return {
    permission: "ask",
    user_message: reason,
    agent_message: reason,
    category,
  };
}

function allow(extra = {}) {
  return { permission: "allow", ...extra };
}

function isLocalhostUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(String(url));
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(String(url));
  }
}

function extractUrls(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const found = text.match(/https?:\/\/[^\s"'\\]+/gi) || [];
  const bare = text.match(/["']((?:localhost|127\.0\.0\.1)[^"']*)["']/gi) || [];
  return [...found, ...bare.map((s) => s.replace(/['"]/g, ""))];
}

function shellDecision(policy, command) {
  const cmd = String(command || "");
  const lower = cmd.toLowerCase();

  if (/\bgit\s+push\b/.test(lower)) {
    const allowed = policy.shell?.allowPushBranches || [];
    if (!allowed.length) return deny("git-push", "git push yasaktır (Faz 4 öncesi tüm push reddedilir).");
    // allowPushBranches doluysa yalnızca eşleşen branch; aksi halde ret
    const branchMatch = cmd.match(/\bgit\s+push\b(?:\s+\S+)?\s+(\S+)/i);
    const branch = branchMatch?.[1] || "";
    const ok = allowed.some((pat) => {
      if (pat.endsWith("/*")) return branch.startsWith(pat.slice(0, -1));
      return branch === pat || new RegExp("^" + pat.replace(/\*/g, ".*") + "$").test(branch);
    });
    if (!ok) return deny("git-push", "Bu branch için git push politikada izinli değil.");
  }

  if (/\b--no-verify\b/.test(lower)) {
    return deny("git-bypass", "git --no-verify yasaktır.");
  }

  if (/\bgit\s+remote\s+add\b/.test(lower)) {
    return deny("git-remote", "git remote add yasaktır.");
  }

  const branch = currentGitBranch();
  const onProtected = branch === "main" || branch === "master";
  if (onProtected && /\bgit\s+(commit|merge|rebase|reset)\b/.test(lower)) {
    return deny(
      "git-protected-branch",
      `main/master üzerinde git ${lower.match(/\bgit\s+(commit|merge|rebase|reset)\b/)?.[1]} yasaktır.`,
    );
  }
  if (/\bgit\s+(merge|rebase|reset)\b/.test(lower) && /\b(main|master)\b/.test(lower)) {
    return deny("git-protected-branch", "main/master ile merge/rebase/reset yasaktır.");
  }

  if (
    /\b(vercel\b|kubectl\b|terraform\s+apply\b|\baws\b|\baz\b|\bgcloud\b|\bssh\b|\bscp\b|docker\s+push\b|npm\s+publish\b|pnpm\s+publish\b|yarn\s+publish\b)/.test(
      lower,
    )
  ) {
    return deny("deploy-cli", "Deploy / bulut / uzak erişim CLI komutları yasaktır.");
  }

  if (/\bgh\s+pr\s+(create|merge)\b/.test(lower)) {
    return deny("gh-write", "gh pr create/merge yasaktır (onay kapısı).");
  }

  if (
    /\b(drop\s+(table|database|schema)|truncate\s+table|alter\s+table\s+\S+\s+drop)\b/.test(lower) ||
    /\bdelete\s+from\b/.test(lower)
  ) {
    return deny("db-destructive", "Yıkıcı SQL komutları yasaktır.");
  }

  if (policy.shell?.denyAllDatabaseCli && /\b(psql|mysql|sqlcmd|mongo|redis-cli)\b/.test(lower)) {
    return deny("database", "Veritabanı CLI kullanımı bu fazda yasaktır.");
  }

  if (
    /\b(printenv|env\s*\|)\b/.test(lower) ||
    /\bget-childitem\s+env:/i.test(cmd) ||
    /\b\$env:[a-z0-9_]+\b/i.test(cmd) && /\b(key|secret|token|password|credential)/i.test(cmd) ||
    /(^|[\s"'`])(\.env(?:\.[a-z0-9_-]+)?)([\s"'`]|$)/i.test(cmd) &&
      /\b(type|cat|get-content|gc|more|less|bat)\b/i.test(cmd)
  ) {
    return deny("env-dump", "Ortam değişkeni / .env dökümü yasaktır.");
  }

  // Kabuk ile korumalı yola yazma (yönlendirme / Out-File / Set-Content)
  for (const pat of policy.protectedPaths || []) {
    const prefix = pat.endsWith("/**") ? pat.slice(0, -3) : pat;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[\\\\/]");
    const writeRe = new RegExp(
      `(>|>>|out-file|set-content|add-content|move-item|copy-item|ni|new-item)[^\\n]*${escaped}`,
      "i",
    );
    if (writeRe.test(cmd)) {
      return deny("protected-path", `Korumalı yola kabuk yazması yasaktır: ${prefix}`);
    }
  }

  // ASK kuralları
  const localhostOk = policy.shell?.allowLocalhostNetwork !== false;
  if (/\b(curl|wget|invoke-webrequest|invoke-restmethod)\b/i.test(cmd)) {
    const urls = extractUrls(cmd);
    const allLocal = urls.length > 0 && urls.every(isLocalhostUrl);
    if (!(localhostOk && allLocal)) {
      return ask("network", "Ağ isteği onay gerektirir.");
    }
  }

  if (/\b(npm|pnpm|yarn|pip|pip3)\s+(install|add|i)\b/i.test(cmd)) {
    return ask("package-install", "Paket kurulumu onay gerektirir.");
  }

  if (/\bdocker\s+(run|compose\s+up|compose\s+-f\b.*\bup)\b/i.test(cmd) || /\bdocker-compose\s+up\b/i.test(cmd)) {
    return ask("container", "Konteyner başlatma onay gerektirir.");
  }

  if (/\brm\s+(-[a-zA-Z]*r|.*\s-r)/i.test(cmd) || /\bremove-item\b.*(-recurse|-r)\b/i.test(cmd)) {
    return ask("recursive-delete", "Özyinelemeli silme onay gerektirir.");
  }

  return allow();
}

function handlePreToolUse(policy, payload, observe) {
  const tool = payload.tool_name || "";
  const input = payload.tool_input || {};

  if (isKillSwitchOn(policy) && !READ_TOOLS.has(tool)) {
    return deny("kill-switch", "Kill switch açık: okuma dışındaki araçlar reddedildi.");
  }

  const filePath = toolPath(input);
  if (filePath) {
    const { rel, outside } = resolveInWorkspace(payload, filePath);

    if (WRITE_TOOLS.has(tool) || tool === "Write" || tool === "Delete") {
      if (outside) {
        return deny("outside-workspace", "Çalışma alanı dışına yazma yasaktır.");
      }
      if (isProtectedPath(policy, rel) || isProtectedPath(policy, filePath)) {
        return deny("protected-path", `Korumalı yola yazma yasaktır: ${mask(normPath(rel || filePath))}`);
      }
    }

    if (isSecretPath(policy, rel) || isSecretPath(policy, filePath)) {
      return deny("secret-access", `Gizli dosyaya erişim yasaktır: ${mask(normPath(rel || filePath))}`);
    }
  }

  // Shell yazmaları ayrıca beforeShellExecution'da; burada Task vb. serbest
  return allow({
    observed: { toolName: tool, inputKeys: Object.keys(input || {}) },
  });
}

function handleBeforeShell(policy, payload) {
  if (isKillSwitchOn(policy)) {
    return deny("kill-switch", "Kill switch açık: kabuk komutları reddedildi.");
  }
  return shellDecision(policy, payload.command || "");
}

function handleBeforeMcp(policy, payload) {
  if (isKillSwitchOn(policy)) {
    return deny("kill-switch", "Kill switch açık: MCP çağrıları reddedildi.");
  }
  const server = payload.mcp_server_name || "";
  const allowed = policy.mcp?.allowedServers || [];
  if (!server || !allowed.includes(server)) {
    return deny("mcp", `MCP sunucusu izin listesinde değil: ${server || "(yok)"}`);
  }
  const localOnly = policy.mcp?.localhostOnlyServers || [];
  if (localOnly.includes(server)) {
    const urls = extractUrls(payload.tool_input);
    // navigate/url alanları
    let inputObj = payload.tool_input;
    if (typeof inputObj === "string") {
      try {
        inputObj = JSON.parse(inputObj);
      } catch {
        inputObj = {};
      }
    }
    if (inputObj && typeof inputObj === "object") {
      for (const key of ["url", "uri", "href", "path"]) {
        if (inputObj[key]) urls.push(String(inputObj[key]));
      }
    }
    const httpUrls = urls.filter((u) => /^https?:\/\//i.test(u) || /^(localhost|127\.|\[::1\])/i.test(u));
    if (httpUrls.length && !httpUrls.every(isLocalhostUrl)) {
      return deny("mcp", "Tarayıcı MCP yalnızca localhost için izinlidir.");
    }
  }
  return allow();
}

function handleSubagentStart(policy, payload) {
  if (isKillSwitchOn(policy)) {
    return deny("kill-switch", "Kill switch açık: alt ajan başlatılamaz.");
  }

  const model = payload.subagent_model || payload.model || "";
  if (isDeniedModel(model, policy.subagents?.deniedModelPatterns)) {
    return deny("model-policy", `Yasak model deseni: ${mask(model)}`);
  }

  const state = loadState(policy);
  const now = Date.now();
  pruneSlots(state, policy.subagents.slotTtlMinutes, now);
  pruneLaunches(state, policy.subagents.launchWindowHours, now);

  if (state.active.length >= policy.subagents.maxConcurrent) {
    return deny(
      "concurrency",
      `Eşzamanlı alt ajan sınırı aşıldı (max ${policy.subagents.maxConcurrent}).`,
    );
  }

  const conv = payload.conversation_id || payload.parent_conversation_id || "unknown";
  const launch = state.launches[conv] || { count: 0, first: new Date(now).toISOString() };
  if (launch.count >= policy.subagents.maxLaunchesPerConversation) {
    return deny(
      "launch-budget",
      `Oturum başına alt ajan sınırı aşıldı (max ${policy.subagents.maxLaunchesPerConversation}).`,
    );
  }

  const id = payload.subagent_id || `sa-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const task = String(payload.task || "").slice(0, 160);
  state.active.push({
    id,
    type: payload.subagent_type || "unknown",
    model: model || undefined,
    parent: conv,
    taskHash: taskHash(payload.task),
    task: mask(task) || undefined,
    startedAt: new Date(now).toISOString(),
  });
  launch.count += 1;
  state.launches[conv] = launch;
  saveState(policy, state);

  return allow({
    subagent: { id, type: payload.subagent_type, model },
  });
}

function handleSubagentStop(policy, payload) {
  const state = loadState(policy);
  pruneSlots(state, policy.subagents.slotTtlMinutes);
  const type = payload.subagent_type;
  const hash = taskHash(payload.task);
  let idx = state.active.findIndex((s) => s.type === type && s.taskHash === hash);
  if (idx < 0) idx = state.active.findIndex((s) => s.type === type);
  if (idx >= 0) state.active.splice(idx, 1);
  saveState(policy, state);
  return {
    // followup_message asla dönülmez
    _auditSubagent: {
      type,
      status: payload.status,
      durationMs: payload.duration_ms,
      toolCalls: payload.tool_call_count,
      modifiedFiles: Array.isArray(payload.modified_files) ? payload.modified_files.length : undefined,
      task: mask(String(payload.task || "").slice(0, 160)) || undefined,
    },
  };
}

function handleBeforeSubmit(policy, payload) {
  const prompt = String(payload.prompt || "");
  if (PROMPT_SECRET_RE.test(prompt)) {
    return {
      continue: false,
      user_message: "İstemde gizli anahtar benzeri içerik algılandı; gönderim engellendi.",
      category: "prompt-secret",
      permission: "deny",
    };
  }
  return { continue: true, permission: "allow" };
}

function finalize(event, policy, payload, observe, result) {
  const intended = result.permission || (result.continue === false ? "deny" : result.continue === true ? "allow" : "info");
  const category = result.category;
  const mode = observe ? "observe" : "enforce";

  const auditEntry = {
    event,
    mode,
    decision: observe && intended !== "allow" && intended !== "info" ? "observe" : intended,
    category,
    reason: result.user_message || result.agent_message,
    tool: payload.tool_name || (event === "beforeShellExecution" ? "Shell" : undefined),
    target: mask(
      payload.command
        ? String(payload.command).slice(0, 200)
        : toolPath(payload.tool_input)
          ? normPath(toolPath(payload.tool_input))
          : payload.mcp_server_name || payload.subagent_type || undefined,
    ),
    conversation: payload.conversation_id || payload.parent_conversation_id,
  };

  if (result.subagent || result._auditSubagent) {
    auditEntry.subagent = result.subagent || result._auditSubagent;
  }
  if (result.observed) auditEntry.observed = result.observed;

  writeAudit(policy, auditEntry);

  if (observe) {
    if (event === "beforeSubmitPrompt") return { continue: true };
    if (event === "subagentStop" || event === "sessionStart" || event === "stop" || event === "afterShellExecution" || event === "afterFileEdit") {
      return {};
    }
    return { permission: "allow" };
  }

  if (event === "beforeSubmitPrompt") {
    return {
      continue: result.continue !== false,
      ...(result.continue === false ? { user_message: result.user_message } : {}),
    };
  }

  if (event === "subagentStop") return {};
  if (event === "sessionStart" || event === "stop" || event === "afterShellExecution" || event === "afterFileEdit") {
    return {};
  }

  const out = { permission: result.permission || "allow" };
  if (result.user_message) out.user_message = result.user_message;
  if (result.agent_message) out.agent_message = result.agent_message;
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const observe = args.includes("--observe");
  const event = args.find((a) => !a.startsWith("-")) || "unknown";

  let policy;
  try {
    policy = loadPolicy();
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        permission: "deny",
        user_message: "Guard politikası okunamadı.",
        agent_message: "Guard politikası okunamadı.",
      }) + "\n",
    );
    process.exit(0);
  }

  const payload = await readStdin();
  if (payload.__parseError) {
    writeAudit(policy, {
      event,
      mode: observe ? "observe" : "enforce",
      decision: "error",
      category: "guard-error",
      reason: "stdin JSON parse hatası",
    });
    // Permission hook'larda geçersiz JSON eylemi engeller; her zaman geçerli JSON bas.
    const safe =
      event === "beforeSubmitPrompt"
        ? { continue: observe }
        : event === "subagentStop" || event === "sessionStart" || event === "stop"
          ? {}
          : observe
            ? { permission: "allow" }
            : {
                permission: "deny",
                user_message: "Guard girdi JSON'u okuyamadı.",
                agent_message: "Guard girdi JSON'u okuyamadı.",
              };
    process.stdout.write(JSON.stringify(safe) + "\n");
    process.exit(0);
  }

  let result;
  try {
    switch (event) {
      case "preToolUse":
        result = handlePreToolUse(policy, payload, observe);
        break;
      case "beforeShellExecution":
        result = handleBeforeShell(policy, payload);
        break;
      case "beforeMCPExecution":
        result = handleBeforeMcp(policy, payload);
        break;
      case "subagentStart":
        result = handleSubagentStart(policy, payload);
        break;
      case "subagentStop":
        result = handleSubagentStop(policy, payload);
        break;
      case "beforeSubmitPrompt":
        result = handleBeforeSubmit(policy, payload);
        break;
      case "sessionStart":
      case "stop":
        result = { permission: "allow" };
        break;
      case "afterShellExecution":
      case "afterFileEdit":
        result = {
          permission: "allow",
          observed: {
            toolName: payload.tool_name,
            inputKeys: payload.tool_input ? Object.keys(payload.tool_input) : undefined,
          },
        };
        break;
      default:
        result = allow();
    }
  } catch (err) {
    writeAudit(policy, {
      event,
      mode: observe ? "observe" : "enforce",
      decision: "error",
      category: "guard-error",
      reason: mask(String(err && err.message ? err.message : err)),
    });
    result = observe
      ? allow()
      : deny("guard-error", "Guard iç hatası; işlem reddedildi (fail-closed).");
  }

  const out = finalize(event, policy, payload, observe, result);
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(0);
}

main();
