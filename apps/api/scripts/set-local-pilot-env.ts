/**
 * T-P5E-001 — yalnızca yerel AI pilot anahtarlarını upsert eder.
 * Gizli değerleri yazdırmaz.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT_ENV = path.resolve(process.cwd(), "../../.env");
const UPDATES: Record<string, string> = {
  MODEL_PROVIDER: "local",
  LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434",
  LOCAL_LLM_MODEL: "qwen2.5:14b",
  LOCAL_AI_PILOT: "true",
  CLOUD_AGENT_LIVE_ENABLED: "false",
  CURSOR_CLOUD_MODE: "mock",
  CLOUD_ON_DEMAND_VERIFIED: "false",
};

if (!existsSync(ROOT_ENV)) {
  console.error("missing_env_file");
  process.exit(1);
}

const raw = readFileSync(ROOT_ENV, "utf8");
const lines = raw.split(/\r?\n/);
const seen = new Set<string>();
const next = lines.map((line) => {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!m) return line;
  const key = m[1]!;
  if (!(key in UPDATES)) return line;
  seen.add(key);
  return `${key}=${UPDATES[key]}`;
});

for (const [key, value] of Object.entries(UPDATES)) {
  if (!seen.has(key)) next.push(`${key}=${value}`);
}

writeFileSync(ROOT_ENV, `${next.join("\n").replace(/\n+$/, "\n")}`, "utf8");
console.log(
  JSON.stringify({
    ok: true,
    path: ".env",
    updatedKeys: Object.keys(UPDATES),
    values: UPDATES,
  }),
);
