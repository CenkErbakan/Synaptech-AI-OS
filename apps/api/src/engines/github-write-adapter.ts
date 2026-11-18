import { getEnv } from "../lib/env.js";
import { DEFAULT_OWNER_GRANTS, type OwnerGrants, readOwnerGrants } from "./owner-grants.js";

export type GithubWritePrepareInput = {
  taskId: string;
  projectSlug: string;
  verifiedRepo: boolean;
};

export type GithubWritePrepareResult = {
  allowed: boolean;
  mode: "off" | "mock" | "live";
  pushed: false;
  prOpened: false;
  branch: string | null;
  reason: string;
  liveNetwork: false;
};

export function evaluateGithubWrite(
  input: GithubWritePrepareInput,
  grants: OwnerGrants = DEFAULT_OWNER_GRANTS,
  mode: "off" | "mock" | "live" = "off",
): GithubWritePrepareResult {
  const branch = `ai/${input.taskId}`;
  if (!input.verifiedRepo) {
    return {
      allowed: false,
      mode,
      pushed: false,
      prOpened: false,
      branch: null,
      reason: "unverified_repo",
      liveNetwork: false,
    };
  }
  if (!grants.githubPushDraftPr) {
    return {
      allowed: false,
      mode,
      pushed: false,
      prOpened: false,
      branch: null,
      reason: "owner_grant_required:githubPushDraftPr",
      liveNetwork: false,
    };
  }
  if (mode === "off") {
    return {
      allowed: false,
      mode: "off",
      pushed: false,
      prOpened: false,
      branch: null,
      reason: "github_write_mode_off",
      liveNetwork: false,
    };
  }
  return {
    allowed: true,
    mode,
    pushed: false,
    prOpened: false,
    branch,
    reason: mode === "live" ? "live_ready_call_execute" : "mock_prepared_no_network",
    liveNetwork: false,
  };
}

export async function prepareGithubWrite(
  input: GithubWritePrepareInput,
): Promise<GithubWritePrepareResult> {
  const env = getEnv();
  const grants = await readOwnerGrants();
  return evaluateGithubWrite(input, grants, env.GITHUB_WRITE_MODE);
}
