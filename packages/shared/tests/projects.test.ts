import { describe, expect, it } from "vitest";

import { isKnownProjectSlug, KNOWN_PROJECTS } from "../src/domain/projects.js";

describe("KNOWN_PROJECTS", () => {
  it("dört benzersiz slug içerir ve synaptech-ai-os vardır", () => {
    expect(KNOWN_PROJECTS).toHaveLength(4);
    const slugs = KNOWN_PROJECTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(4);
    expect(slugs).toContain("synaptech");
    expect(slugs).toContain("synaptech-ai-os");
    expect(slugs).toContain("subify");
    expect(slugs).toContain("marivo");
  });

  it("hiçbir projeye varsayılan Cloud Agent vermez", () => {
    expect(KNOWN_PROJECTS.every((p) => p.defaultCloudAgentEnabled === false)).toBe(true);
  });

  it("synaptech kurumsal site, synaptech-ai-os şirket OS kimliğindedir", () => {
    expect(KNOWN_PROJECTS.find((p) => p.slug === "synaptech")?.kind).toBe("corporate_website");
    expect(KNOWN_PROJECTS.find((p) => p.slug === "synaptech-ai-os")?.kind).toBe("company_os");
  });

  it("isKnownProjectSlug doğrular", () => {
    expect(isKnownProjectSlug("synaptech-ai-os")).toBe(true);
    expect(isKnownProjectSlug("unknown")).toBe(false);
  });
});
