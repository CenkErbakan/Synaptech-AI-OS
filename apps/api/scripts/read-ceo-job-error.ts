import { disconnectPrisma, getPrisma } from "../src/db/prisma.js";

async function main() {
  const prisma = getPrisma();
  const leases = await prisma.workerLease.findMany({
    select: { lockKey: true, holderId: true, expiresAt: true, heartbeatAt: true },
  });
  const runs = await prisma.scheduledJobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 8,
    select: {
      id: true,
      status: true,
      message: true,
      startedAt: true,
      finishedAt: true,
      idempotencyKey: true,
      resultJson: true,
    },
  });
  console.log(JSON.stringify({ leases, runs }, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
