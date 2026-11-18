import { describe, expect, it } from "vitest";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const testKillSwitchFile = path.join(
  os.tmpdir(),
  `synaptech-kill-switch-integ-${randomUUID()}.json`,
);
fs.writeFileSync(
  testKillSwitchFile,
  `${JSON.stringify({ enabled: false, reason: null, changedBy: null, changedAt: null }, null, 2)}\n`,
  "utf8",
);
process.env.KILL_SWITCH_FILE = testKillSwitchFile;
process.env.KILL_SWITCH_SKIP_FILE_MIRROR = "true";
process.env.NODE_ENV = "test";
process.env.CLOUD_AGENT_LIVE_ENABLED = "false";
process.env.CURSOR_CLOUD_MODE = "mock";

const ownerToken = process.env.SYNAPTECH_OWNER_TOKEN;
const hasDb = Boolean(process.env.DATABASE_URL && ownerToken);

describe("getCursorCredentialStatus export", () => {
  it("resolveCursorCredentials yoktur; getCursorCredentialStatus vardır", async () => {
    const mod = await import("../src/cursor/credentials.js");
    expect(typeof mod.getCursorCredentialStatus).toBe("function");
    expect("resolveCursorCredentials" in mod).toBe(false);
  });
});

describe.runIf(hasDb)("GET /api/integrations/status", () => {
  it("configDeclared ile observedRuntime ayrılır; secret sızmaz; modlar değişmez", async () => {
    const { resetEnvCacheForTests } = await import("../src/lib/env.js");
    resetEnvCacheForTests();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/integrations/status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      configDeclaredStatus: { cursor: string; github: string };
      observedRuntimeStatus: {
        cursor: {
          credentialConfigured: boolean;
          connectivityVerified: string;
          liveEnabled: boolean;
          pastPilotExists: boolean;
          label: string;
        };
        github: { appInstallVerified: string; label: string };
        projects: Array<{ slug: string; verified: boolean }>;
      };
      modesUnchanged: {
        cloudLiveEnabled: boolean;
        cursorCloudMode: string;
        schedulerAiCeoMode: string;
      };
      safety: { noCloudAgentCreated: boolean; secretsRedacted: boolean };
    };

    const raw = res.body;
    expect(raw).not.toMatch(/CURSOR_API_KEY\s*[:=]\s*\S{8,}/i);
    expect(raw).not.toMatch(/github_pat_/i);

    expect(body.configDeclaredStatus.cursor).toBe("none");
    expect(body.configDeclaredStatus.github).toBe("not_connected");
    expect(body.observedRuntimeStatus.cursor).toBeTruthy();
    expect(body.observedRuntimeStatus.github.appInstallVerified).toBe("unknown");
    expect(body.modesUnchanged.cloudLiveEnabled).toBe(false);
    expect(body.modesUnchanged.cursorCloudMode).toBe("mock");
    expect(body.modesUnchanged.schedulerAiCeoMode).toBe("off");
    expect(body.safety.noCloudAgentCreated).toBe(true);
    expect(body.safety.secretsRedacted).toBe(true);

    const subify = body.observedRuntimeStatus.projects.find((p) => p.slug === "subify");
    expect(subify?.verified).toBe(true);

    await app.close();
  });
});
