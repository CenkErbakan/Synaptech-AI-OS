import { disconnectPrisma } from "../src/db/prisma.js";
import { readOwnerGrants, writeOwnerGrants } from "../src/engines/owner-grants.js";

async function main() {
  const previous = await readOwnerGrants();
  const next = await writeOwnerGrants(
    {
      githubRepoCreate: false,
      githubPushDraftPr: false,
      customerOutreach: false,
      productionDeploy: false,
      financialSpend: false,
      permanentLocalAutonomy: previous.permanentLocalAutonomy,
    },
    "owner",
  );
  console.log(
    JSON.stringify(
      {
        previous: {
          githubRepoCreate: previous.githubRepoCreate,
          githubPushDraftPr: previous.githubPushDraftPr,
          customerOutreach: previous.customerOutreach,
          productionDeploy: previous.productionDeploy,
          financialSpend: previous.financialSpend,
          permanentLocalAutonomy: previous.permanentLocalAutonomy,
        },
        next: {
          githubRepoCreate: next.githubRepoCreate,
          githubPushDraftPr: next.githubPushDraftPr,
          customerOutreach: next.customerOutreach,
          productionDeploy: next.productionDeploy,
          financialSpend: next.financialSpend,
          permanentLocalAutonomy: next.permanentLocalAutonomy,
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
