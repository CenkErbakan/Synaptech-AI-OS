/**
 * Owner tam operasyon sıfırlaması.
 * Varsayılan: --stop + dry-run. Silme yalnızca --apply ve doğrulanmış backup sonrası.
 * Kullanım: pnpm --filter @synaptech/api exec tsx scripts/full-ops-reset.ts [--stop] [--backup] [--apply]
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";
import { writeAudit } from "../src/engines/audit.js";
import { getKillSwitch } from "../src/engines/kill-switch.js";
import { DEFAULT_OWNER_GRANTS, readOwnerGrants, writeOwnerGrants } from "../src/engines/owner-grants.js";
import { readOperationEpoch } from "../src/engines/operation-epoch.js";
import { getSchedulerRuntimeStatus } from "../src/engines/autonomy-scheduler.js";
import {
  DELETE_TABLES,
  RESET_SETTING_KEYS,
  UNLISTED_OPERATIONAL_TABLES,
  buildNewEpoch,
  classifyLeadRow,
  classifyOpportunityRow,
  unexpectedDboTables,
} from "../src/engines/ops-reset.js";

const apply = process.argv.includes("--apply");
const doBackup = process.argv.includes("--backup") || apply;
const doStop = process.argv.includes("--stop") || apply || true;

type Counts = Record<string, number>;

async function tableCounts(): Promise<Counts> {
  const p = getPrisma();
  const entries: Array<[string, Promise<number>]> = [
    ["Task", p.task.count()],
    ["TaskEvent", p.taskEvent.count()],
    ["TaskAssignment", p.taskAssignment.count()],
    ["Approval", p.approval.count()],
    ["ApprovalEvent", p.approvalEvent.count()],
    ["AgentRun", p.agentRun.count()],
    ["AgentMessage", p.agentMessage.count()],
    ["Opportunity", p.opportunity.count()],
    ["Lead", p.lead.count()],
    ["ScheduledJobRun", p.scheduledJobRun.count()],
    ["WorkerLease", p.workerLease.count()],
    ["SeoFinding", p.seoFinding.count()],
    ["ContentDraftRecord", p.contentDraftRecord.count()],
    ["AdProposal", p.adProposal.count()],
    ["GrowthScanRun", p.growthScanRun.count()],
    ["Agent", p.agent.count()],
    ["Project", p.project.count()],
    ["CompanyGoal", p.companyGoal.count()],
    ["User", p.user.count()],
    ["AuditLog", p.auditLog.count()],
    ["AutonomyPolicy", p.autonomyPolicy.count()],
    ["ScheduledJob", p.scheduledJob.count()],
    ["IntegrationConnection", p.integrationConnection.count()],
    ["SystemSetting", p.systemSetting.count()],
    ["WorkerInstance", p.workerInstance.count()],
  ];
  const out: Counts = {};
  for (const [k, q] of entries) out[k] = await q;
  return out;
}

async function listDboTables(): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<Array<{ TABLE_NAME: string }>>`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_TYPE = 'BASE TABLE'
  `;
  return rows.map((r) => r.TABLE_NAME);
}

function runDocker(args: string[], timeoutMs = 180_000) {
  return spawnSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: timeoutMs });
}

function takeMssqlBackup(stamp: string): {
  ok: boolean;
  containerPath: string;
  hostPath: string | null;
  verify: string | null;
  sha256: string | null;
  bytes: number | null;
  error?: string;
} {
  const file = `synaptech-pre-reset-${stamp}.bak`;
  const containerPath = `/var/opt/mssql/backup/${file}`;
  const hostDir = path.resolve(process.cwd(), "../../reports/ops/mssql-backups");
  mkdirSync(hostDir, { recursive: true });
  const hostPath = path.join(hostDir, file);

  const mkdir = runDocker(["exec", "synaptech-ai-os-mssql", "mkdir", "-p", "/var/opt/mssql/backup"]);
  if (mkdir.status !== 0) {
    return {
      ok: false,
      containerPath,
      hostPath: null,
      verify: null,
      sha256: null,
      bytes: null,
      error: mkdir.stderr || mkdir.stdout || "mkdir_failed",
    };
  }

  const backupSql = `BACKUP DATABASE [SynaptechAiOs] TO DISK = N'${containerPath}' WITH FORMAT, INIT, CHECKSUM, STATS = 5`;
  const bak = runDocker(
    [
      "exec",
      "synaptech-ai-os-mssql",
      "bash",
      "-lc",
      `/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "${backupSql.replace(/"/g, '\\"')}"`,
    ],
    300_000,
  );
  if (bak.status !== 0) {
    return {
      ok: false,
      containerPath,
      hostPath: null,
      verify: bak.stdout || null,
      sha256: null,
      bytes: null,
      error: bak.stderr || bak.stdout || "backup_failed",
    };
  }

  const verifySql = `RESTORE VERIFYONLY FROM DISK = N'${containerPath}' WITH CHECKSUM`;
  const ver = runDocker(
    [
      "exec",
      "synaptech-ai-os-mssql",
      "bash",
      "-lc",
      `/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "${verifySql.replace(/"/g, '\\"')}"`,
    ],
    180_000,
  );
  const verifyText = `${ver.stdout ?? ""}\n${ver.stderr ?? ""}`;
  const verifyOk =
    ver.status === 0 && !/Msg \d+, Level (1[6-9]|[2-9]\d)/.test(verifyText);
  if (!verifyOk) {
    return {
      ok: false,
      containerPath,
      hostPath: null,
      verify: ver.stdout || ver.stderr,
      sha256: null,
      bytes: null,
      error: "verifyonly_failed",
    };
  }

  const cp = runDocker(["cp", `synaptech-ai-os-mssql:${containerPath}`, hostPath], 180_000);
  if (cp.status !== 0 || !existsSync(hostPath)) {
    return {
      ok: false,
      containerPath,
      hostPath: null,
      verify: ver.stdout,
      sha256: null,
      bytes: null,
      error: cp.stderr || "docker_cp_failed",
    };
  }
  const buf = readFileSync(hostPath);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  return {
    ok: true,
    containerPath,
    hostPath,
    verify: "RESTORE VERIFYONLY valid",
    sha256,
    bytes: buf.length,
  };
}

async function stopAutonomy() {
  const p = getPrisma();
  const now = new Date().toISOString();
  await p.systemSetting.upsert({
    where: { key: "kill_switch" },
    create: {
      key: "kill_switch",
      value: JSON.stringify({
        enabled: true,
        reason: "Owner tam operasyon sıfırlaması — yeni görev ve dispatch durduruldu",
        changedBy: "Owner",
        changedAt: now,
      }),
      updatedBy: "owner",
    },
    update: {
      value: JSON.stringify({
        enabled: true,
        reason: "Owner tam operasyon sıfırlaması — yeni görev ve dispatch durduruldu",
        changedBy: "Owner",
        changedAt: now,
      }),
      updatedBy: "owner",
    },
  });
  const grants = await writeOwnerGrants(
    {
      ...DEFAULT_OWNER_GRANTS,
      githubRepoCreate: false,
      githubPushDraftPr: false,
      customerOutreach: false,
      productionDeploy: false,
      financialSpend: false,
      permanentLocalAutonomy: false,
    },
    "owner",
  );
  await p.scheduledJob.updateMany({ data: { enabled: false } });
  await p.systemSetting.upsert({
    where: { key: "ceo_event_pending" },
    create: { key: "ceo_event_pending", value: "0", updatedBy: "owner" },
    update: { value: "0", updatedBy: "owner" },
  });
  const windowRow = await p.systemSetting.findUnique({ where: { key: "controlled_autonomy_window" } });
  if (windowRow?.value) {
    try {
      const parsed = JSON.parse(windowRow.value) as Record<string, unknown>;
      await p.systemSetting.update({
        where: { key: "controlled_autonomy_window" },
        data: {
          value: JSON.stringify({
            ...parsed,
            enabled: false,
            closedAt: now,
            closeReason: "ops_full_reset",
          }),
          updatedBy: "owner",
        },
      });
    } catch {
      /* ignore malformed */
    }
  }
  await writeAudit({
    category: "security",
    action: "ops.reset_autonomy_stopped",
    actorKind: "owner",
    summary: "Otonomi durduruldu (kill switch DB, grant kapalı, job disabled)",
    metadata: { permanentLocalAutonomy: grants.permanentLocalAutonomy, realAiExecution: false },
  });
  return { grants, kill: await getKillSwitch() };
}

async function classifyCrm() {
  const p = getPrisma();
  const leads = await p.lead.findMany({
    select: { id: true, companyName: true, sourceKind: true, status: true, notes: true, projectSlug: true },
  });
  const opps = await p.opportunity.findMany({
    select: { id: true, title: true, sourceKind: true, projectSlug: true, verified: true },
  });
  const leadClasses = leads.map((l) => ({ ...l, cls: classifyLeadRow(l) }));
  const oppClasses = opps.map((o) => ({ ...o, cls: classifyOpportunityRow(o) }));
  const blocked =
    leadClasses.some((l) => l.cls !== "delete_test_or_self") ||
    oppClasses.some((o) => o.cls !== "delete_test_or_self");
  return { leadClasses, oppClasses, blocked };
}

async function applyReset(deletedBefore: Counts, backupPath: string) {
  const p = getPrisma();
  const epoch = buildNewEpoch();
  const grants = await readOwnerGrants();

  await p.$transaction(
    async (tx) => {
      await tx.agentMessage.deleteMany();
      await tx.taskEvent.deleteMany();
      await tx.taskAssignment.deleteMany();
      await tx.agentRun.deleteMany();
      await tx.approvalEvent.deleteMany();
      await tx.approval.deleteMany();
      await tx.task.updateMany({ data: { parentTaskId: null, dependsOnTaskId: null, approvalId: null } });
      await tx.task.deleteMany();
      await tx.opportunity.deleteMany();
      await tx.lead.deleteMany();
      await tx.scheduledJobRun.deleteMany();
      await tx.workerLease.deleteMany();

      await tx.systemSetting.upsert({
        where: { key: "operation_epoch" },
        create: { key: "operation_epoch", value: JSON.stringify(epoch), updatedBy: "owner" },
        update: { value: JSON.stringify(epoch), updatedBy: "owner" },
      });
      await tx.systemSetting.upsert({
        where: { key: "deferred_llm_queue" },
        create: { key: "deferred_llm_queue", value: "[]", updatedBy: "owner" },
        update: { value: "[]", updatedBy: "owner" },
      });
      await tx.systemSetting.upsert({
        where: { key: "ceo_event_pending" },
        create: { key: "ceo_event_pending", value: "0", updatedBy: "owner" },
        update: { value: "0", updatedBy: "owner" },
      });
      await tx.systemSetting.upsert({
        where: { key: "ceo_provider_circuit" },
        create: {
          key: "ceo_provider_circuit",
          value: JSON.stringify({
            failures: 0,
            lastFailureAt: null,
            lastError: null,
            openUntil: null,
            lastSuccessAt: null,
          }),
          updatedBy: "owner",
        },
        update: {
          value: JSON.stringify({
            failures: 0,
            lastFailureAt: null,
            lastError: null,
            openUntil: null,
            lastSuccessAt: null,
          }),
          updatedBy: "owner",
        },
      });
    },
    { timeout: 180_000, maxWait: 30_000 },
  );

  await writeOwnerGrants(
    {
      githubRepoCreate: false,
      githubPushDraftPr: false,
      customerOutreach: false,
      productionDeploy: false,
      financialSpend: false,
      permanentLocalAutonomy: false,
    },
    "owner",
  );

  await writeAudit({
    category: "ops",
    action: "ops.full_operational_reset",
    actorKind: "owner",
    summary: "Tam operasyon sıfırlaması uygulandı (Task/Approval/Message fiziksel silindi)",
    metadata: {
      deletedBefore,
      backupPath,
      epoch,
      grantsAfter: grants,
      realAiExecution: false,
    },
  });
  return epoch;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.resolve(process.cwd(), "../../reports/ops");
  mkdirSync(reportDir, { recursive: true });

  const runtime = getSchedulerRuntimeStatus();
  const before = await tableCounts();
  const dbo = await listDboTables();
  const unexpected = unexpectedDboTables(dbo);
  const crm = await classifyCrm();
  const epochBefore = await readOperationEpoch();
  const grantsBefore = await readOwnerGrants();
  const agents = await getPrisma().agent.findMany({ select: { id: true, name: true, enabled: true } });
  const projects = await getPrisma().project.findMany({
    select: { slug: true, githubRepoUrl: true, cloudAgentEnabled: true },
  });
  const goals = await getPrisma().companyGoal.findMany({ select: { goalKey: true, projectSlug: true, status: true } });
  const settings = await getPrisma().systemSetting.findMany({ select: { key: true } });
  const pendingApprovals = await getPrisma().approval.count({ where: { status: "pending" } });
  const jobs = await getPrisma().scheduledJob.findMany({ select: { jobKey: true, enabled: true } });

  let stopResult = null;
  if (doStop) {
    stopResult = await stopAutonomy();
  }

  let backup = null as ReturnType<typeof takeMssqlBackup> | null;
  if (doBackup) {
    backup = takeMssqlBackup(stamp);
  }

  const blockedReasons: string[] = [];
  if (unexpected.length) blockedReasons.push(`unexpected_tables:${unexpected.join(",")}`);
  if (crm.blocked) blockedReasons.push("crm_not_all_test_or_self");
  if (doBackup && !backup?.ok) blockedReasons.push(`backup_failed:${backup?.error ?? "unknown"}`);
  if (apply && blockedReasons.length) {
    const payload = {
      ok: false,
      apply: false,
      blocked: true,
      blockedReasons,
      before,
      unexpected,
      crmSummary: {
        leads: crm.leadClasses.length,
        opportunities: crm.oppClasses.length,
        preserveOrUnknown: [...crm.leadClasses, ...crm.oppClasses].filter((x) => x.cls !== "delete_test_or_self"),
      },
      backup,
    };
    writeFileSync(path.join(reportDir, `full-ops-reset-${stamp}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  let epoch = epochBefore;
  let after = before;
  if (apply) {
    if (!backup?.ok) throw new Error("backup_required");
    epoch = await applyReset(before, backup.hostPath ?? backup.containerPath);
    after = await tableCounts();
  }

  const verify = {
    task: after.Task,
    approval: after.Approval,
    agentMessage: after.AgentMessage,
    agent: after.Agent,
    project: after.Project,
    companyGoal: after.CompanyGoal,
    auditLog: after.AuditLog,
    kill: await getKillSwitch(),
    grants: await readOwnerGrants(),
    epoch,
    jobs: await getPrisma().scheduledJob.findMany({ select: { jobKey: true, enabled: true } }),
    runtime,
  };

  const payload = {
    ok: !apply || (after.Task === 0 && after.Approval === 0 && after.AgentMessage === 0),
    apply,
    blocked: false,
    at: new Date().toISOString(),
    stopResult: stopResult
      ? {
          killEnabled: stopResult.kill.enabled,
          permanentLocalAutonomy: stopResult.grants.permanentLocalAutonomy,
          killSource: stopResult.kill.source,
        }
      : null,
    backup: backup
      ? {
          ok: backup.ok,
          hostPath: backup.hostPath,
          containerPath: backup.containerPath,
          verify: backup.verify,
          sha256: backup.sha256,
          bytes: backup.bytes,
          error: backup.error,
        }
      : null,
    deleteTables: DELETE_TABLES,
    unlistedOperationalLeftIntact: UNLISTED_OPERATIONAL_TABLES,
    resetSettingKeys: RESET_SETTING_KEYS,
    countsBefore: before,
    countsAfter: apply ? after : null,
    pendingApprovalsBefore: pendingApprovals,
    unexpectedDbo: unexpected,
    crm: {
      blocked: crm.blocked,
      leads: crm.leadClasses,
      opportunities: crm.oppClasses,
    },
    preserved: { agents, projects, goals, settingKeys: settings.map((s) => s.key) },
    jobsBefore: jobs,
    verify,
    note: apply
      ? "Fiziksel silme uygulandı. Otonomi kapalı. Yeni LLM yok."
      : "Dry-run. Silme yok.",
  };

  const outPath = path.join(reportDir, `full-ops-reset-${stamp}.json`);
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ ...payload, reportPath: outPath }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
