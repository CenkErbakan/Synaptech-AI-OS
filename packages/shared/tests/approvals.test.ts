import { describe, expect, it } from "vitest";

import {
  ApprovalError,
  decideApproval,
  effectiveApprovalStatus,
  isApprovalValidFor,
  recordSubjectVersion,
  type ApprovalRequest,
} from "../src/domain/approvals";
import { NOW } from "./helpers";

const base: ApprovalRequest = {
  id: "A-1",
  source: "demo",
  type: "protected_branch_merge",
  requestedBy: "developer",
  projectSlug: "synaptech",
  title: "agent/T-1 → main",
  description: "Örnek",
  changeSummary: "1 dosya",
  risk: "high",
  subject: { kind: "git_commit", ref: "agent/T-1", version: "sha:aaa" },
  currentVersion: "sha:aaa",
  status: "pending",
  createdAt: NOW.toISOString(),
  executor: "trusted-executor",
};

const user = { kind: "user" } as const;

function expectApprovalError(fn: () => unknown, code: ApprovalError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalError);
    expect((error as ApprovalError).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

describe("decideApproval", () => {
  it("onayı yalnızca kullanıcı verebilir", () => {
    expectApprovalError(
      () => decideApproval(base, "approved", { actor: { kind: "agent", agentId: "cto" }, now: NOW, killSwitchEnabled: false }),
      "forbidden_actor",
    );
    expectApprovalError(
      () => decideApproval(base, "approved", { actor: { kind: "system" }, now: NOW, killSwitchEnabled: false }),
      "forbidden_actor",
    );
  });

  it("onayı talep edilen sürüme bağlar", () => {
    const approved = decideApproval(base, "approved", { actor: user, now: NOW, killSwitchEnabled: false });
    expect(approved.status).toBe("approved");
    expect(approved.decision?.boundVersion).toBe("sha:aaa");
    expect(isApprovalValidFor(approved, "sha:aaa")).toBe(true);
    expect(isApprovalValidFor(approved, "sha:bbb")).toBe(false);
  });

  it("sürüm değişince onay geçersiz olur", () => {
    const approved = decideApproval(base, "approved", { actor: user, now: NOW, killSwitchEnabled: false });
    const changed = recordSubjectVersion(approved, "sha:bbb");
    expect(effectiveApprovalStatus(changed)).toBe("invalidated");
    expect(isApprovalValidFor(changed, "sha:bbb")).toBe(false);
  });

  it("talep sonrası değişmiş içeriği onaylamayı reddeder", () => {
    const drifted = recordSubjectVersion(base, "sha:ccc");
    expectApprovalError(
      () => decideApproval(drifted, "approved", { actor: user, now: NOW, killSwitchEnabled: false }),
      "version_mismatch",
    );
  });

  it("kill switch açıkken onayı reddeder ama ret kararına izin verir", () => {
    expectApprovalError(
      () => decideApproval(base, "approved", { actor: user, now: NOW, killSwitchEnabled: true }),
      "kill_switch",
    );
    const rejected = decideApproval(base, "rejected", { actor: user, now: NOW, killSwitchEnabled: true, note: "Hayır" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.decision?.note).toBe("Hayır");
  });

  it("karar verilmiş talebi tekrar karara açmaz", () => {
    const rejected = decideApproval(base, "rejected", { actor: user, now: NOW, killSwitchEnabled: false });
    expectApprovalError(
      () => decideApproval(rejected, "approved", { actor: user, now: NOW, killSwitchEnabled: false }),
      "not_pending",
    );
  });
});
