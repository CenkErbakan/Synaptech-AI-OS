/**
 * Belirtilen .env anahtarlarını upsert eder. Argüman: KEY=VAL KEY=VAL ...
 * Gizli anahtar değerlerini yazdırmaz; yalnızca verilen non-secret pilot anahtarları.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT_ENV = path.resolve(process.cwd(), "../../.env");
const updates: Record<string, string> = {};
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf("=");
  if (i <= 0) continue;
  updates[arg.slice(0, i)] = arg.slice(i + 1);
}
if (!Object.keys(updates).length || !existsSync(ROOT_ENV)) {
  console.error("usage_or_missing_env");
  process.exit(1);
}

const lines = readFileSync(ROOT_ENV, "utf8").split(/\r?\n/);
const seen = new Set<string>();
const next = lines.map((line) => {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!m) return line;
  const key = m[1]!;
  if (!(key in updates)) return line;
  seen.add(key);
  return `${key}=${updates[key]}`;
});
for (const [k, v] of Object.entries(updates)) {
  if (!seen.has(k)) next.push(`${k}=${v}`);
}
writeFileSync(ROOT_ENV, `${next.join("\n").replace(/\n+$/, "\n")}`, "utf8");
console.log(JSON.stringify({ ok: true, keys: Object.keys(updates), values: updates }));
