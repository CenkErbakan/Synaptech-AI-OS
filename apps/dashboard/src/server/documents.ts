import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ContentDraftFrontmatterSchema, DocumentFrontmatterSchema } from "@synaptech/shared";

import type { ContentDraftFile, DocumentArea, RepoDocument } from "@/lib/types";

import { isNotFound, splitFrontmatter } from "./files";
import { repoPath } from "./paths";

const DOCUMENT_AREAS: readonly DocumentArea[] = ["reports", "content", "marketing", "tasks"];
const MAX_DEPTH = 4;

async function listMarkdownFiles(relativeDirectory: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await readdir(repoPath(relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const childPath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "templates" || entry.name.startsWith(".")) continue;
      files.push(...(await listMarkdownFiles(childPath, depth + 1)));
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      files.push(childPath);
    }
  }
  return files;
}

function titleFrom(body: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  return heading?.[1]?.trim() || fallback;
}

/** Ajanların ürettiği gerçek belgeler; şablonlar ve README dosyaları sayılmaz. */
export async function loadDocuments(): Promise<RepoDocument[]> {
  const documents: RepoDocument[] = [];

  for (const area of DOCUMENT_AREAS) {
    for (const relativePath of await listMarkdownFiles(area)) {
      const absolutePath = repoPath(relativePath);
      const [text, info] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
      const { data, body } = splitFrontmatter(text);
      const frontmatter = DocumentFrontmatterSchema.safeParse(data ?? {});
      const meta = frontmatter.success ? frontmatter.data : {};
      documents.push({
        source: "repo-file",
        path: relativePath,
        area,
        title: meta.title ?? titleFrom(body, path.basename(relativePath, ".md")),
        frontmatter: meta,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }

  return documents.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function loadContentDrafts(): Promise<ContentDraftFile[]> {
  const drafts: ContentDraftFile[] = [];

  for (const lang of ["tr", "en"] as const) {
    for (const relativePath of await listMarkdownFiles(`content/blog/drafts/${lang}`)) {
      const absolutePath = repoPath(relativePath);
      const [text, info] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
      const { data, body } = splitFrontmatter(text);
      const parsed = ContentDraftFrontmatterSchema.safeParse(data ?? {});
      drafts.push({
        source: "repo-file",
        path: relativePath,
        lang,
        title: parsed.success ? parsed.data.title : titleFrom(body, path.basename(relativePath, ".md")),
        frontmatter: parsed.success ? parsed.data : null,
        error: parsed.success ? undefined : "Frontmatter şablona uymuyor.",
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }

  return drafts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
