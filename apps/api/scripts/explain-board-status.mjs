import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const token = process.env.SYNAPTECH_OWNER_TOKEN;
const base = process.env.SYNAPTECH_API_URL || "http://127.0.0.1:3101";
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

const [tasksRes, approvalsRes, cloudRes, runsRes] = await Promise.all([
  fetch(`${base}/api/tasks`, { headers }),
  fetch(`${base}/api/approvals`, { headers }),
  fetch(`${base}/api/cloud/status`, { headers }),
  fetch(`${base}/api/cloud/runs`, { headers }),
]);

const tasks = await tasksRes.json();
const approvals = await approvalsRes.json();
const cloud = await cloudRes.json();
const runs = await runsRes.json();

const out = {
  cloud: {
    liveEnabled: cloud.cloud?.liveEnabled,
    mode: cloud.cloud?.mode,
    activeRuns: cloud.cloud?.activeRuns,
    connection: cloud.cloud?.connection,
  },
  tasks: (tasks.tasks ?? []).map((t) => ({
    title: t.title,
    status: t.status,
    dispatchState: t.dispatchState,
    projectSlug: t.projectSlug,
    assignee: t.assignee,
    hasApprovalId: Boolean(t.approvalId),
  })),
  recentCloudRuns: (runs.runs ?? []).slice(0, 5).map((r) => ({
    title: r.taskTitle,
    status: r.status,
    cursorStatus: r.cursorStatus,
    executionMode: r.executionMode,
    branch: r.branch,
  })),
  pendingCloudApprovals: (approvals.approvals ?? [])
    .filter((a) => a.type === "cloud_agent_run" && (a.status === "pending" || a.effectiveStatus === "pending"))
    .map((a) => ({ title: a.title, status: a.status, effectiveStatus: a.effectiveStatus })),
};

console.log(JSON.stringify(out, null, 2));
