import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "@prisma/client";

import { getEnv } from "../lib/env.js";

let prisma: PrismaClient | null = null;

function parseJdbcUrl(url: string) {
  // sqlserver://host:port;database=...;user=...;password=...;encrypt=true;trustServerCertificate=true
  const withoutProtocol = url.replace(/^sqlserver:\/\//i, "");
  const [hostPort, ...rest] = withoutProtocol.split(";");
  const [server, portRaw] = (hostPort ?? "127.0.0.1:14333").split(":");
  const params = Object.fromEntries(
    rest
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        if (idx < 0) return [part.toLowerCase(), ""];
        return [part.slice(0, idx).toLowerCase(), part.slice(idx + 1)];
      }),
  ) as Record<string, string>;

  return {
    server: server || "127.0.0.1",
    port: Number(portRaw || params.port || 14333),
    database: params.database || params["initial catalog"] || "SynaptechAiOs",
    user: params.user || params.uid || params.username || "sa",
    password: params.password || params.pwd || "",
    options: {
      encrypt: String(params.encrypt ?? "false").toLowerCase() === "true",
      trustServerCertificate: String(params.trustservercertificate ?? "true").toLowerCase() !== "false",
    },
  };
}

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  const env = getEnv();
  const config = parseJdbcUrl(env.DATABASE_URL);
  const adapter = new PrismaMssql(config);
  prisma = new PrismaClient({ adapter });
  return prisma;
}

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await getPrisma().$queryRaw`SELECT 1 AS ok`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "DB bağlantı hatası",
    };
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
