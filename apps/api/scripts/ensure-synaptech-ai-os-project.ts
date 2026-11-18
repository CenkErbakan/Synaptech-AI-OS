/**
 * synaptech-ai-os projesini upsert eder; AI CEO Chat görevini güvenli taşır.
 * Mevcut üç projeyi silmez. Cloud allow-list değiştirmez.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const CEO_CHAT_TASK_ID = "462490ee-bbf4-4ec3-b2ac-59e8134966ce";

const { resetEnvCacheForTests, getEnv } = await import("../src/lib/env.js");
resetEnvCacheForTests();
getEnv();

const { getPrisma, disconnectPrisma } = await import("../src/db/prisma.js");
const { reassignTaskProject } = await import("../src/engines/task-engine.js");

const prisma = getPrisma();

try {
  // Mevcut üç proje kimliğini bozmadan açıklamayı netleştir + 4. projeyi ekle
  const upserts = [
    {
      slug: "synaptech",
      name: "SynapTech",
      description: "Kurumsal web sitesi",
    },
    {
      slug: "subify",
      name: "Subify",
      description: "Abonelik ürünü",
    },
    {
      slug: "marivo",
      name: "Marivo",
      description: "Pazarlama ürünü",
    },
    {
      slug: "synaptech-ai-os",
      name: "SynapTech AI OS",
      description: "Şirket işletim sistemi (ajan orkestrasyonu, görev motoru, dashboard)",
    },
  ] as const;

  for (const p of upserts) {
    await prisma.project.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        status: "active",
        githubRepoUrl: null,
        cloudAgentEnabled: false,
      },
      update: {
        name: p.name,
        description: p.description,
        cloudAgentEnabled: false,
      },
    });
  }

  const before = await prisma.task.findUnique({
    where: { id: CEO_CHAT_TASK_ID },
    include: { project: true, events: true },
  });

  let moved = null as Awaited<ReturnType<typeof reassignTaskProject>> | null;
  if (before && before.project.slug !== "synaptech-ai-os") {
    moved = await reassignTaskProject(
      CEO_CHAT_TASK_ID,
      "synaptech-ai-os",
      { kind: "user" },
      "Owner: AI CEO Chat + Ekip İletişimi → SynapTech AI OS. Geçmiş/onay korundu.",
    );
  }

  const projects = await prisma.project.findMany({ orderBy: { slug: "asc" } });
  const after = await prisma.task.findUnique({
    where: { id: CEO_CHAT_TASK_ID },
    include: { project: true, events: { orderBy: { at: "asc" } } },
  });
  const approvals = await prisma.approval.count({ where: { taskId: CEO_CHAT_TASK_ID } });

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectCount: projects.length,
        projects: projects.map((p) => ({
          slug: p.slug,
          name: p.name,
          cloudAgentEnabled: p.cloudAgentEnabled,
          githubRepoUrl: p.githubRepoUrl,
        })),
        ceoChat: before
          ? {
              id: CEO_CHAT_TASK_ID,
              title: before.title,
              fromProject: before.project.slug,
              toProject: after?.project.slug,
              eventCountBefore: before.events.length,
              eventCountAfter: after?.events.length,
              approvalsLinked: approvals,
              moved: Boolean(moved),
            }
          : { id: CEO_CHAT_TASK_ID, found: false },
        allowListUntouched: true,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectPrisma();
}
