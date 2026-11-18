import { describe, expect, it } from "vitest";

import {
  APPROVAL_TYPES,
  CURSOR_RUN_STATUSES,
  DISPATCH_STATES,
  isActiveCursorRun,
  isTerminalCursorRun,
  mapCursorRunToDomain,
} from "../src";

describe("cursor-cloud domain", () => {
  it("resmi run durumlarını listeler", () => {
    expect(CURSOR_RUN_STATUSES).toContain("CREATING");
    expect(CURSOR_RUN_STATUSES).toContain("WAITING_FOR_BACKGROUND_WORK");
    expect(CURSOR_RUN_STATUSES).toContain("FINISHED");
  });

  it("dispatch durumlarına reconciliation ekler", () => {
    expect(DISPATCH_STATES).toContain("awaiting_execution_approval");
    expect(DISPATCH_STATES).toContain("reconciliation_required");
  });

  it("cloud_agent_run onay türünü içerir", () => {
    expect(APPROVAL_TYPES).toContain("cloud_agent_run");
  });

  it("aktif/terminal sınıflandırması doğru", () => {
    expect(isActiveCursorRun("RUNNING")).toBe(true);
    expect(isActiveCursorRun("FINISHED")).toBe(false);
    expect(isTerminalCursorRun("CANCELLED")).toBe(true);
  });

  it("FINISHED → in_review (otomatik done yok)", () => {
    expect(mapCursorRunToDomain("FINISHED").taskStatus).toBe("in_review");
  });
});
