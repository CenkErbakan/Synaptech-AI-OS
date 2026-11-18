import fs from "node:fs";
import path from "node:path";

const KEY_RE = /^([A-Z][A-Z0-9_]+)=/gm;

/** .env anahtar adlarını okur; değerleri döndürmez. */
export function listEnvFileKeys(filePath: string): string[] {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return [...text.matchAll(KEY_RE)].map((m) => m[1]!);
  } catch {
    return [];
  }
}

export function diffEnvFileVsRuntime(opts?: { repoRoot?: string }): {
  fileFound: boolean;
  fileKeyCount: number;
  missingInRuntime: string[];
  presentInRuntimeNotInFile: string[];
} {
  const root = opts?.repoRoot ?? path.resolve(process.cwd(), "../..");
  const filePath = path.join(root, ".env");
  const fileKeys = listEnvFileKeys(filePath);
  const runtime = Object.keys(process.env).filter((k) => /^[A-Z][A-Z0-9_]+$/.test(k));
  const fileSet = new Set(fileKeys);
  const runSet = new Set(runtime);
  return {
    fileFound: fileKeys.length > 0,
    fileKeyCount: fileKeys.length,
    missingInRuntime: fileKeys.filter((k) => !runSet.has(k)),
    presentInRuntimeNotInFile: runtime.filter((k) => !fileSet.has(k)).slice(0, 40),
  };
}
