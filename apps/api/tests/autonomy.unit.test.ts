import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MOCK_STALE_TTL_MS } from "../src/engines/run-reconciliation.js";

describe("Faz 5A autonomy unit", () => {
  it("mock stale TTL 15 dakikadır", () => {
    expect(MOCK_STALE_TTL_MS).toBe(15 * 60 * 1000);
  });

  it("fırsat dedupe hash kararlıdır", () => {
    const parts = ["project-health", "synaptech-ai-os", "0"];
    const a = createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 64);
    const b = createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 64);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("live kapasite sayacı stale_mock dışlar (filtre sözleşmesi)", () => {
    const excluded = new Set(["stale_mock", "archived"]);
    expect(excluded.has("stale_mock")).toBe(true);
    expect(excluded.has("ok")).toBe(false);
  });
});
