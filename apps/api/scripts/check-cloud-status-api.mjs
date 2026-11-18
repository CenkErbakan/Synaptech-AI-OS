/**
 * Yerel API üzerinden cloud status. Secret yazdırmaz. Live create yok.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const token = process.env.SYNAPTECH_OWNER_TOKEN;
const base = process.env.SYNAPTECH_API_URL || "http://127.0.0.1:3101";

if (!token) {
  console.log(JSON.stringify({ ok: false, error: "SYNAPTECH_OWNER_TOKEN missing" }));
  process.exit(2);
}

const res = await fetch(`${base}/api/cloud/status`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const json = await res.json().catch(() => null);
console.log(
  JSON.stringify(
    {
      httpStatus: res.status,
      activeRuns: json?.cloud?.activeRuns ?? null,
      liveEnabled: json?.cloud?.liveEnabled ?? null,
      mode: json?.cloud?.mode ?? null,
      keyConfigured: json?.cloud?.apiKeyPresent ?? json?.cloud?.keyConfigured ?? null,
      allowedRepositories: json?.cloud?.allowedRepositories ?? null,
      onDemandStatus: json?.cloud?.onDemandStatus ?? null,
      connection: json?.cloud?.connection ?? null,
    },
    null,
    2,
  ),
);
process.exit(res.ok ? 0 : 1);
