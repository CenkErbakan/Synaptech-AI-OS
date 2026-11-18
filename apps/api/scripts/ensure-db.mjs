import sql from "mssql";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const password = process.env.MSSQL_SA_PASSWORD;
if (!password) {
  console.error("MSSQL_SA_PASSWORD eksik");
  process.exit(1);
}

const pool = await sql.connect({
  server: "localhost",
  port: 14333,
  user: "sa",
  password,
  options: { encrypt: false, trustServerCertificate: true },
  database: "master",
});

await pool.request().query(`
IF DB_ID(N'SynaptechAiOs') IS NULL
BEGIN
  CREATE DATABASE SynaptechAiOs;
END
`);
console.log("SynaptechAiOs hazır.");
await pool.close();
