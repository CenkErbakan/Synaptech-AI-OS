import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const token = process.env.SYNAPTECH_OWNER_TOKEN;
  if (!token) throw new Error("token yok");
  const res = await fetch("http://127.0.0.1:3101/api/ai/agents/execution-status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json()) as Record<string, unknown>;
  console.log(
    JSON.stringify(
      {
        httpStatus: res.status,
        mode: j.mode,
        continuousAutomation: j.continuousAutomation,
        cloudAutoDispatch: j.cloudAutoDispatch,
        envLocal: process.env.LOCAL_AGENT_EXECUTION_MODE,
        envScheduler: process.env.SCHEDULER_AI_CEO_MODE,
        envCloudLive: process.env.CLOUD_AGENT_LIVE_ENABLED,
        envCloudMode: process.env.CURSOR_CLOUD_MODE,
      },
      null,
      2,
    ),
  );
  if (j.mode !== "off") process.exit(2);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
