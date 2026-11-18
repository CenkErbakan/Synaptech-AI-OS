import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const token = process.env.SYNAPTECH_OWNER_TOKEN;
const res = await fetch("http://127.0.0.1:3101/api/tasks/ceo", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `browser-e2e-${Date.now()}`,
  },
  body: JSON.stringify({
    title: "Dashboard E2E CEO görevi",
    description: "Sayfa yenileme testi",
    projectSlug: "synaptech",
    priority: "high",
    notes: "Faz3",
  }),
});
const json = await res.json();
if (!res.ok) {
  console.error(json);
  process.exit(1);
}
console.log(
  JSON.stringify({
    id: json.task.id,
    status: json.task.status,
    dispatch: json.task.dispatchState,
    source: json.task.source,
  }),
);
