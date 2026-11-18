import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const pick = (key) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : "";
};
const out = `SYNAPTECH_API_URL=${pick("SYNAPTECH_API_URL") || "http://127.0.0.1:3101"}
SYNAPTECH_OWNER_TOKEN=${pick("SYNAPTECH_OWNER_TOKEN")}
`;
fs.writeFileSync(path.join(root, "apps/dashboard/.env.local"), out);
console.log("dashboard .env.local yazıldı");
