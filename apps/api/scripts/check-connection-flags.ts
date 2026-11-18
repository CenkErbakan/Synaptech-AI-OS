import { disconnectPrisma } from "../src/db/prisma.js";
import { getEnv } from "../src/lib/env.js";
import { githubWriteStatus } from "../src/engines/github-rest.js";
import { readOwnerGrants } from "../src/engines/owner-grants.js";

async function main() {
  const env = getEnv();
  const github = githubWriteStatus();
  const grants = await readOwnerGrants();
  console.log(
    JSON.stringify(
      {
        githubTokenConfigured: github.tokenConfigured,
        githubMode: github.mode,
        githubWriteEnabled: github.writeEnabled,
        smtpHostSet: Boolean(env.SMTP_HOST?.trim()),
        smtpFromSet: Boolean(env.SMTP_FROM?.trim()),
        smtpUserSet: Boolean(env.SMTP_USER?.trim()),
        smtpPasswordSet: Boolean(env.SMTP_PASSWORD?.trim()),
        emailMode: env.EMAIL_OUTREACH_MODE,
        cloudLive: env.CLOUD_AGENT_LIVE_ENABLED,
        grants: {
          githubRepoCreate: grants.githubRepoCreate,
          githubPushDraftPr: grants.githubPushDraftPr,
          customerOutreach: grants.customerOutreach,
          productionDeploy: grants.productionDeploy,
          financialSpend: grants.financialSpend,
        },
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
