import "server-only";

import { readFile } from "node:fs/promises";

import YAML from "yaml";
import type { ZodType } from "zod";

import type { LoadResult } from "@/lib/types";

import { repoPath } from "./paths";

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export const FILE_NOT_FOUND = "Dosya bulunamadı.";

export async function readRepoText(relativePath: string): Promise<string | null> {
  try {
    return await readFile(repoPath(relativePath), "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join(".") || "(kök)"}: ${issue.message}`)
    .join("; ");
}

function validate<T>(raw: unknown, schema: ZodType<T>, relativePath: string): LoadResult<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data, path: relativePath }
    : { ok: false, error: `Şema hatası: ${formatIssues(parsed.error.issues)}`, path: relativePath };
}

export async function loadYamlFile<T>(relativePath: string, schema: ZodType<T>): Promise<LoadResult<T>> {
  const text = await readRepoText(relativePath);
  if (text === null) return { ok: false, error: FILE_NOT_FOUND, path: relativePath };
  try {
    return validate(YAML.parse(text), schema, relativePath);
  } catch (error) {
    return { ok: false, error: `YAML okunamadı: ${(error as Error).message}`, path: relativePath };
  }
}

export async function loadJsonFile<T>(relativePath: string, schema: ZodType<T>): Promise<LoadResult<T>> {
  const text = await readRepoText(relativePath);
  if (text === null) return { ok: false, error: FILE_NOT_FOUND, path: relativePath };
  try {
    return validate(JSON.parse(text), schema, relativePath);
  } catch (error) {
    return { ok: false, error: `JSON okunamadı: ${(error as Error).message}`, path: relativePath };
  }
}

export function splitFrontmatter(text: string): { data: unknown; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  try {
    return { data: YAML.parse(match[1] ?? "") ?? {}, body: text.slice(match[0].length) };
  } catch {
    return { data: null, body: text };
  }
}
