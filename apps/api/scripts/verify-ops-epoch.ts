import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { buildCommandCenter } from "../src/engines/command-center.js";
import { countEpochTasks, readOperationEpoch } from "../src/engines/operation-epoch.js";
import { githubWriteStatus } from "../src/engines/github-rest.js";
import { getEnv } from "../src/lib/env.js";
import { getKillSwitch } from "../src/engines/kill-switch.js";
import { enforceAutonomyWindow } from "../src/engines/autonomy-window.js";

async function main() {
  const env = getEnv();
  const prisma = getPrisma();
  const [cc, epoch, kill, windowGate, agents, projects, goals] = await Promise.all([
    buildCommandCenter(),
    readOperationEpoch(),
    getKillSwitch(),
    enforceAutonomyWindow(),
    prisma.agent.count(),
    prisma.project.count(),
    prisma.companyGoal.count(),
  ]);
  const counts = await countEpochTasks(epoch);
  let ollama: Record<string, unknown> = { reachable: false, qwen14: false };
  try {
    const base = env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434";
    const res = await fetch(`${base.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (json.models ?? []).map((m) => m.name);
    ollama = {
      reachable: res.ok,
      qwen14: names.some((n) => n === "qwen2.5:14b" || n.startsWith("qwen2.5:14b")),
      qwenNames: names.filter((n) => n.includes("qwen")),
    };
  } catch (e) {
    ollama = { reachable: false, qwen14: false, error: e instanceof Error ? e.message : "fail" };
  }
  console.log(
    JSON.stringify(
      {
        epoch,
        counts,
        ownerInboxPending: cc.ownerInbox.pendingCount,
        company: cc.company,
        llm: cc.llm,
        grants: cc.grants.values,
        githubWrite: cc.grants.githubWrite,
        githubStatus: githubWriteStatus(),
        modes: cc.modes,
        kill: kill.enabled,
        window: { active: windowGate.active, reason: windowGate.reason },
        preserved: { agents, projects, goals },
        smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_FROM),
        emailMode: env.EMAIL_OUTREACH_MODE,
        ollama,
        crmLeadCountShown: cc.crm.recentLeads.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
