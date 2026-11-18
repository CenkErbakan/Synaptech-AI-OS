import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
loadDotenv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

