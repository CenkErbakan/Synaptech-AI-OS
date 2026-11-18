import type { OwnerGrants } from "./owner-grants.js";

export type GrantRuntimeMismatch = {
  grantKey: keyof OwnerGrants;
  grantValue: boolean;
  runtimeClosed: boolean;
  risk: "grant_true_runtime_off";
};

/** Grant=true / mode=off: bayrak açık görünür ama dış eylem runtime'da kapalı. */
export function listGrantRuntimeMismatches(input: {
  grants: OwnerGrants;
  githubWriteMode: "off" | "mock" | "live";
  cloudLiveEnabled: boolean;
}): GrantRuntimeMismatch[] {
  const out: GrantRuntimeMismatch[] = [];
  const githubRuntimeClosed = input.githubWriteMode === "off";
  if (input.grants.githubRepoCreate && githubRuntimeClosed) {
    out.push({
      grantKey: "githubRepoCreate",
      grantValue: true,
      runtimeClosed: true,
      risk: "grant_true_runtime_off",
    });
  }
  if (input.grants.githubPushDraftPr && githubRuntimeClosed) {
    out.push({
      grantKey: "githubPushDraftPr",
      grantValue: true,
      runtimeClosed: true,
      risk: "grant_true_runtime_off",
    });
  }
  if (input.grants.customerOutreach) {
    out.push({
      grantKey: "customerOutreach",
      grantValue: true,
      runtimeClosed: true,
      risk: "grant_true_runtime_off",
    });
  }
  if (input.grants.productionDeploy) {
    out.push({
      grantKey: "productionDeploy",
      grantValue: true,
      runtimeClosed: true,
      risk: "grant_true_runtime_off",
    });
  }
  if (input.grants.financialSpend) {
    out.push({
      grantKey: "financialSpend",
      grantValue: true,
      runtimeClosed: true,
      risk: "grant_true_runtime_off",
    });
  }
  if (input.grants.githubPushDraftPr && input.cloudLiveEnabled) {
    // live cloud + grant: mismatch değil; yine de ağ yazması ayrı kapı
  }
  return out;
}
