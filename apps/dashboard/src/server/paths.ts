import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

let cachedRoot: string | null = null;

/** Monorepo kökü: SYNAPTECH_ROOT değişkeni ya da pnpm-workspace.yaml ve config/ içeren ilk üst dizin. */
export function getRepoRoot(): string {
  if (cachedRoot) return cachedRoot;

  const fromEnv = process.env.SYNAPTECH_ROOT;
  if (fromEnv) {
    cachedRoot = path.resolve(fromEnv);
    return cachedRoot;
  }

  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(path.join(directory, "pnpm-workspace.yaml")) &&
      existsSync(path.join(directory, "config"))
    ) {
      cachedRoot = directory;
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("SynapTech AI OS kök dizini bulunamadı (pnpm-workspace.yaml ve config/ aranıyor).");
}

export function repoPath(...segments: string[]): string {
  return path.join(/*turbopackIgnore: true*/ getRepoRoot(), ...segments);
}

export function toRepoRelative(absolutePath: string): string {
  return path.relative(getRepoRoot(), absolutePath).split(path.sep).join("/");
}
