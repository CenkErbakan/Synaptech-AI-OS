import { describe, expect, it } from "vitest";

import {
  assertPilotCreateOptions,
  computeCloudRunContentVersion,
  isAllowedAgentBranch,
  isProtectedBaseBranch,
  PILOT_AUTO_CREATE_PR,
  PILOT_WORK_ON_CURRENT_BRANCH,
} from "../src/cursor/pilot-policy.js";

describe("pilot-policy", () => {
  it("main ve master korumalı base sayılır", () => {
    expect(isProtectedBaseBranch("main")).toBe(true);
    expect(isProtectedBaseBranch("master")).toBe(true);
    expect(isProtectedBaseBranch("cursor/pilot")).toBe(false);
  });

  it("yalnızca cursor/ ve agent/ çalışma branch'ine izin verir", () => {
    expect(isAllowedAgentBranch("cursor/t-p4b-001")).toBe(true);
    expect(isAllowedAgentBranch("agent/hello")).toBe(true);
    expect(isAllowedAgentBranch("feature/x")).toBe(false);
    expect(isAllowedAgentBranch("master")).toBe(false);
  });

  it("create seçeneklerinde autoCreatePR ve workOnCurrentBranch zorunlu false", () => {
    expect(PILOT_AUTO_CREATE_PR).toBe(false);
    expect(PILOT_WORK_ON_CURRENT_BRANCH).toBe(false);
    expect(() =>
      assertPilotCreateOptions({
        startingRef: "master",
        autoCreatePR: false,
        workOnCurrentBranch: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertPilotCreateOptions({
        startingRef: "master",
        autoCreatePR: true,
        workOnCurrentBranch: false,
      }),
    ).toThrow(/autoCreatePR/);
    expect(() =>
      assertPilotCreateOptions({
        startingRef: "master",
        autoCreatePR: false,
        workOnCurrentBranch: true,
      }),
    ).toThrow(/workOnCurrentBranch/);
    expect(() =>
      assertPilotCreateOptions({
        startingRef: "develop",
        autoCreatePR: false,
        workOnCurrentBranch: false,
      }),
    ).toThrow(/startingRef/);
  });

  it("contentVersion brief veya politika değişince farklılaşır", () => {
    const base = {
      title: "Pilot",
      description: "hello",
      repositoryUrl: "https://github.com/CenkErbakan/SynapTech-AI-OS-Pilot",
      startingRef: "master",
      briefSha256: "abc",
    };
    const a = computeCloudRunContentVersion(base);
    const b = computeCloudRunContentVersion({ ...base, briefSha256: "def" });
    const c = computeCloudRunContentVersion({ ...base, startingRef: "main" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
