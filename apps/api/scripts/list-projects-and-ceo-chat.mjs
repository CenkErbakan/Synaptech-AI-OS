/**
 * Projeler + "AI CEO Chat" görev araması. Secret yazdırmaz.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: path.join(root, ".env") });

const token = process.env.SYNAPTECH_OWNER_TOKEN;
const base = process.env.SYNAPTECH_API_URL || "http://127.0.0.1:3101";

async function get(pathname) {
  const res = await fetch(`${base}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const projects = await get("/api/projects");
const tasks = await get("/api/tasks");
const list = tasks.json?.tasks ?? [];
const matches = list.filter((t) => {
  const hay = `${t.title ?? ""} ${t.description ?? ""}`.toLowerCase();
  return (
    hay.includes("ceo chat") ||
    hay.includes("ekip iletişimi") ||
    hay.includes("ekip iletisimi") ||
    hay.includes("ai ceo chat")
  );
});

console.log(
  JSON.stringify(
    {
      projectsHttp: projects.status,
      projects: projects.json?.projects ?? null,
      taskCount: list.length,
      ceoChatMatches: matches.map((t) => ({
        id: t.id,
        title: t.title,
        projectSlug: t.projectSlug,
        status: t.status,
        assignee: t.assignee,
        source: t.source,
      })),
    },
    null,
    2,
  ),
);
