import { disconnectPrisma } from "../src/db/prisma.js";
import { readOwnerGrants, writeOwnerGrants } from "../src/engines/owner-grants.js";
import { githubWriteStatus } from "../src/engines/github-rest.js";
import { getEnv } from "../src/lib/env.js";

async function main() {
  const before = await readOwnerGrants();
  const after = await writeOwnerGrants(
    {
      githubRepoCreate: true,
      githubPushDraftPr: true,
      customerOutreach: true,
      productionDeploy: false,
      financialSpend: false,
      permanentLocalAutonomy: true,
    },
    "owner",
  );
  const env = getEnv();
  console.log(
    JSON.stringify(
      {
        before,
        after,
        github: githubWriteStatus(),
        smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_FROM),
        smtpPasswordSet: Boolean(env.SMTP_PASSWORD?.trim()),
        smtpUserSet: Boolean(env.SMTP_USER?.trim()),
        cloudLive: env.CLOUD_AGENT_LIVE_ENABLED,
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
