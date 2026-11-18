import { getEnv } from "../lib/env.js";
import { assertOwnerGrant } from "./owner-grants.js";

export type GithubOp = "create_repo" | "push_branch" | "open_draft_pr";

export type GithubRestResult = {
  ok: boolean;
  blocked: boolean;
  networkAttempted: boolean;
  op: GithubOp;
  reason: string;
  url: string | null;
  status: number | null;
};

function tokenConfigured(): boolean {
  const t = getEnv().GITHUB_TOKEN?.trim();
  return Boolean(t && t.length >= 8);
}

function protectedRef(branch: string): boolean {
  const b = branch.replace(/^refs\/heads\//, "").toLowerCase();
  return b === "main" || b === "master";
}

/**
 * Gerçek GitHub REST. Yazma: grant + GITHUB_WRITE_MODE=live + token.
 * Bu turda varsayılan off — ağ yazması yapılmaz.
 */
export function githubOpPrecheck(input: {
  op: GithubOp;
  branch: string;
  writeMode: "off" | "mock" | "live";
  grantOk: boolean;
  tokenConfigured: boolean;
}): { blocked: true; reason: string } | { blocked: false } {
  if (!input.grantOk) return { blocked: true, reason: "owner_grant_required" };
  if (protectedRef(input.branch)) return { blocked: true, reason: "protected_ref_main_master" };
  if (!input.branch.startsWith("ai/") && input.op !== "create_repo") {
    return { blocked: true, reason: "branch_must_be_ai_prefix" };
  }
  if (input.writeMode !== "live") return { blocked: true, reason: `github_write_mode_${input.writeMode}` };
  if (!input.tokenConfigured) return { blocked: true, reason: "github_token_missing" };
  return { blocked: false };
}

export async function executeGithubOp(input: {
  op: GithubOp;
  owner: string;
  repo: string;
  branch: string;
  title?: string;
  body?: string;
}): Promise<GithubRestResult> {
  const env = getEnv();
  const grantKey = input.op === "create_repo" ? "githubRepoCreate" : "githubPushDraftPr";
  const grant = await assertOwnerGrant(grantKey);
  const pre = githubOpPrecheck({
    op: input.op,
    branch: input.branch,
    writeMode: env.GITHUB_WRITE_MODE,
    grantOk: grant.ok,
    tokenConfigured: tokenConfigured(),
  });
  if (pre.blocked) {
    return {
      ok: false,
      blocked: true,
      networkAttempted: false,
      op: input.op,
      reason: pre.reason === "owner_grant_required" ? grant.reason : pre.reason,
      url: null,
      status: null,
    };
  }

  const token = env.GITHUB_TOKEN!.trim();
  const base = env.GITHUB_API_BASE_URL.replace(/\/$/, "");
  const path =
    input.op === "create_repo"
      ? "/user/repos"
      : input.op === "push_branch"
        ? `/repos/${input.owner}/${input.repo}/git/refs`
        : `/repos/${input.owner}/${input.repo}/pulls`;
  const payload =
    input.op === "create_repo"
      ? { name: input.repo, private: true, auto_init: false }
      : input.op === "push_branch"
        ? { ref: `refs/heads/${input.branch}`, sha: "0".repeat(40) }
        : { title: input.title ?? input.branch, head: input.branch, base: "main", draft: true, body: input.body ?? "" };

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SynapTech-AI-OS",
    },
    body: JSON.stringify(payload),
  });
  return {
    ok: res.ok,
    blocked: false,
    networkAttempted: true,
    op: input.op,
    reason: res.ok ? "ok" : `github_http_${res.status}`,
    url: res.url,
    status: res.status,
  };
}

export function githubWriteStatus() {
  const env = getEnv();
  return {
    mode: env.GITHUB_WRITE_MODE,
    tokenConfigured: tokenConfigured(),
    writeEnabled: env.GITHUB_WRITE_MODE === "live" && tokenConfigured(),
    protectedRefsBlocked: true as const,
    allowedBranchPrefix: "ai/",
  };
}
