import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const token = process.env.SYNAPTECH_OWNER_TOKEN;
const base = process.env.SYNAPTECH_API_URL || "http://127.0.0.1:3101";
const res = await fetch(`${base}/api/cloud/runs`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const json = await res.json();
const runs = json.runs ?? [];
const activeish = runs.filter((r) =>
  ["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(String(r.cursorStatus || "")),
);
console.log(
  JSON.stringify(
    {
      httpStatus: res.status,
      totalListed: runs.length,
      activeByCursorStatus: activeish.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        status: r.status,
        cursorStatus: r.cursorStatus,
        executionMode: r.executionMode,
        hasCursorAgentId: Boolean(r.cursorAgentId),
        hasCursorRunId: Boolean(r.cursorRunId),
        createdAt: r.createdAt,
      })),
      latest5: runs.slice(0, 5).map((r) => ({
        id: r.id,
        status: r.status,
        cursorStatus: r.cursorStatus,
        executionMode: r.executionMode,
        createdAt: r.createdAt,
      })),
    },
    null,
    2,
  ),
);
