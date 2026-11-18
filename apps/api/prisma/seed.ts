import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "@prisma/client";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
loadDotenv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL gerekli");

function parseJdbcUrl(raw: string) {
  const withoutProtocol = raw.replace(/^sqlserver:\/\//i, "");
  const [hostPort, ...rest] = withoutProtocol.split(";");
  const [server, portRaw] = (hostPort ?? "127.0.0.1:14333").split(":");
  const params = Object.fromEntries(
    rest
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        return idx < 0 ? [part.toLowerCase(), ""] : [part.slice(0, idx).toLowerCase(), part.slice(idx + 1)];
      }),
  ) as Record<string, string>;
  return {
    server: server || "127.0.0.1",
    port: Number(portRaw || 14333),
    database: params.database || "SynaptechAiOs",
    user: params.user || "sa",
    password: params.password || "",
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };
}

const prisma = new PrismaClient({ adapter: new PrismaMssql(parseJdbcUrl(url)) });

const AGENTS = [
  { id: "ceo", name: "AI CEO", role: "Yönetim", department: "Yönetim", readonlyRole: true },
  { id: "cto", name: "AI CTO", role: "Teknik liderlik", department: "Yazılım", readonlyRole: true },
  { id: "developer", name: "AI Developer", role: "Geliştirme", department: "Yazılım", readonlyRole: false },
  { id: "tester", name: "AI Tester", role: "Kalite", department: "Yazılım", readonlyRole: false },
  { id: "security", name: "AI Security", role: "Güvenlik", department: "Yazılım", readonlyRole: true },
  { id: "growth-lead", name: "AI Growth Lead", role: "Büyüme", department: "Büyüme", readonlyRole: true },
  { id: "seo-specialist", name: "AI SEO Specialist", role: "SEO", department: "Büyüme", readonlyRole: true },
  { id: "content-manager", name: "AI Content Manager", role: "İçerik", department: "Büyüme", readonlyRole: false },
  { id: "ads-manager", name: "AI Ads Manager", role: "Reklam", department: "Büyüme", readonlyRole: true },
] as const;

const PROJECTS = [
  {
    slug: "synaptech",
    name: "SynapTech",
    description: "Kurumsal web sitesi",
    githubRepoUrl: null as string | null,
    cloudAgentEnabled: false,
  },
  {
    slug: "subify",
    name: "Subify",
    description: "Abonelik ürünü",
    githubRepoUrl: null as string | null,
    cloudAgentEnabled: false,
  },
  {
    slug: "marivo",
    name: "Marivo",
    description: "Pazarlama ürünü",
    githubRepoUrl: null as string | null,
    cloudAgentEnabled: false,
  },
  {
    slug: "synaptech-ai-os",
    name: "SynapTech AI OS",
    description: "Şirket işletim sistemi (ajan orkestrasyonu, görev motoru, dashboard)",
    githubRepoUrl: null as string | null,
    cloudAgentEnabled: false,
  },
] as const;

async function main() {
  for (const agent of AGENTS) {
    await prisma.agent.upsert({
      where: { id: agent.id },
      create: { ...agent, enabled: true },
      update: { name: agent.name, role: agent.role, department: agent.department, readonlyRole: agent.readonlyRole },
    });
  }

  for (const project of PROJECTS) {
    await prisma.project.upsert({
      where: { slug: project.slug },
      create: {
        slug: project.slug,
        name: project.name,
        description: project.description,
        status: "active",
        githubRepoUrl: project.githubRepoUrl,
        cloudAgentEnabled: project.cloudAgentEnabled,
      },
      update: {
        name: project.name,
        description: project.description,
        githubRepoUrl: project.githubRepoUrl,
        cloudAgentEnabled: project.cloudAgentEnabled,
      },
    });
  }

  await prisma.user.upsert({
    where: { email: "owner@synaptech.local" },
    create: {
      email: "owner@synaptech.local",
      displayName: "Owner",
      role: "owner",
    },
    update: { displayName: "Owner", role: "owner" },
  });

  await prisma.systemSetting.upsert({
    where: { key: "kill_switch" },
    create: {
      key: "kill_switch",
      value: JSON.stringify({
        enabled: false,
        reason: null,
        changedBy: null,
        changedAt: null,
      }),
      updatedBy: "seed",
    },
    update: {},
  });

  const integrations = [
    { provider: "cursor", status: "not_connected", detail: "Faz 4" },
    { provider: "github", status: "not_connected", detail: "Faz 4" },
    { provider: "mssql", status: "connected", detail: "Yerel Docker" },
  ] as const;
  for (const item of integrations) {
    await prisma.integrationConnection.upsert({
      where: { provider: item.provider },
      create: item,
      update: { status: item.status, detail: item.detail },
    });
  }

  console.log("Seed tamam: 9 ajan, 4 proje, owner, kill_switch, entegrasyonlar.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
