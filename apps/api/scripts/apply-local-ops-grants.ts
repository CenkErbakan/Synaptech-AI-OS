import { disconnectPrisma } from "../src/db/prisma.js";
import { readOwnerGrants, writeOwnerGrants } from "../src/engines/owner-grants.js";
import { getKillSwitch } from "../src/engines/kill-switch.js";
import { readOperationEpoch } from "../src/engines/operation-epoch.js";

async function main() {
  const before = await readOwnerGrants();
  const after = await writeOwnerGrants(
    {
      githubRepoCreate: false,
      githubPushDraftPr: false,
      customerOutreach: false,
      productionDeploy: false,
      financialSpend: false,
      permanentLocalAutonomy: true,
    },
    "owner",
  );
  const kill = await getKillSwitch();
  const epoch = await readOperationEpoch();
  console.log(
    JSON.stringify(
      {
        before,
        after,
        kill: { enabled: kill.enabled, source: kill.source },
        epochId: epoch?.id ?? null,
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
