import { config as loadDotenv } from "dotenv";
import path from "node:path";
import sql from "mssql";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const url = process.env.DATABASE_URL || "";
// sqlserver://localhost:14333;database=...;user=sa;password=...;encrypt=false;trustServerCertificate=true
const parts = Object.fromEntries(
  url
    .replace(/^sqlserver:\/\//, "")
    .split(";")
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      if (i === -1) {
        const [hostPort] = p.split("/");
        const [server, port] = hostPort.split(":");
        return ["server", server.includes("=") ? server : `${server}${port ? `,${port}` : ""}`];
      }
      return [p.slice(0, i).toLowerCase(), p.slice(i + 1)];
    }),
);

const serverPart = url.match(/sqlserver:\/\/([^;]+)/)?.[1] ?? "localhost:14333";
const [server, port] = serverPart.split(":");

const pool = await sql.connect({
  server: server || "localhost",
  port: Number(port || 14333),
  user: parts.user || "sa",
  password: parts.password,
  database: parts.database || "SynaptechAiOs",
  options: { encrypt: false, trustServerCertificate: true },
});

const cols = await pool
  .request()
  .query(
    `SELECT c.name, t.name AS type_name, c.is_nullable
     FROM sys.columns c
     JOIN sys.types t ON c.user_type_id = t.user_type_id
     WHERE c.object_id = OBJECT_ID('dbo.AgentRun')
     ORDER BY c.column_id`,
  );

const idxs = await pool
  .request()
  .query(
    `SELECT i.name, i.is_unique, i.has_filter, i.filter_definition
     FROM sys.indexes i
     WHERE i.object_id = OBJECT_ID('dbo.AgentRun') AND i.name IS NOT NULL`,
  );

const mig = await pool
  .request()
  .query(`SELECT migration_name, finished_at, rolled_back_at, logs
          FROM [_prisma_migrations]
          ORDER BY started_at`);

console.log("COLUMNS:", JSON.stringify(cols.recordset, null, 2));
console.log("INDEXES:", JSON.stringify(idxs.recordset, null, 2));
console.log("MIGRATIONS:", JSON.stringify(mig.recordset, null, 2));
await pool.close();
