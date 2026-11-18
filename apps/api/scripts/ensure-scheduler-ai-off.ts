/**
 * SCHEDULER_AI_CEO_MODE=off garanti eder (canlı otomasyon varsayılan kapalı).
 * Gizli değer yazdırmaz.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT_ENV = path.resolve(process.cwd(), "../../.env");
const KEY = "SCHEDULER_AI_CEO_MODE";
const VALUE = "off";
const KEY2 = "SCHEDULER_AI_CEO_MAX_PER_DAY";
const VALUE2 = "1";

if (!existsSync(ROOT_ENV)) {
  console.error("missing_env");
  process.exit(1);
}

const raw = readFileSync(ROOT_ENV, "utf8");
const lines = raw.split(/\r?\n/);
const seen = new Set<string>();
const next = lines.map((line) => {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!m) return line;
  const key = m[1]!;
  if (key === KEY) {
    seen.add(KEY);
    return `${KEY}=${VALUE}`;
  }
  if (key === KEY2) {
    seen.add(KEY2);
    return `${KEY2}=${VALUE2}`;
  }
  return line;
});
if (!seen.has(KEY)) next.push(`${KEY}=${VALUE}`);
if (!seen.has(KEY2)) next.push(`${KEY2}=${VALUE2}`);
writeFileSync(ROOT_ENV, `${next.join("\n").replace(/\n+$/, "\n")}`, "utf8");
console.log(JSON.stringify({ ok: true, [KEY]: VALUE, [KEY2]: VALUE2 }));
