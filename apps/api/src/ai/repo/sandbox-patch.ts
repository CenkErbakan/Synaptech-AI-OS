import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProposedSandboxPatch, ToolEvidenceRecord } from "@synaptech/shared";

const DENY_NAME = /^(?:\.env|\.env\..*)$/i;
const DENY_EXT = /\.(pem|key|p12|pfx|crt)$/i;
const DENY_PATH_PART =
  /(?:^|\/|\\)(?:\.git|node_modules|\.next|dist|coverage|\.synaptech|secrets?)(?:\/|\\|$)/i;

export type SandboxPatchApplyResult = {
  ok: boolean;
  applied: Array<{
    path: string;
    bytes: number;
    beforeDigest: string;
    afterDigest: string;
  }>;
  rejected: Array<{ path: string; reason: string }>;
  diffText: string;
  evidence: ToolEvidenceRecord;
};

function sha16(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`patch_path_jail:${candidate}`);
  }
  return resolved;
}

function isDeniedPath(relPath: string): string | null {
  const base = path.basename(relPath);
  if (DENY_NAME.test(base)) return "secret_env_denied";
  if (DENY_EXT.test(base)) return "secret_ext_denied";
  if (DENY_PATH_PART.test(relPath.replace(/\\/g, "/"))) return "protected_path_denied";
  if (relPath.includes("..")) return "traversal_denied";
  return null;
}

function fileUnifiedDiff(rel: string, before: string, after: string): string {
  if (before === after) return "";
  const bLines = before.split(/\r?\n/);
  const aLines = after.split(/\r?\n/);
  const lines = [`--- a/${rel}`, `+++ b/${rel}`];
  const max = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < max; i++) {
    const b = bLines[i];
    const a = aLines[i];
    if (b === a) continue;
    if (b !== undefined && a === undefined) lines.push(`-${b}`);
    else if (b === undefined && a !== undefined) lines.push(`+${a}`);
    else {
      lines.push(`-${b}`);
      lines.push(`+${a}`);
    }
  }
  return lines.join("\n");
}

/**
 * Model patch önerilerini yalnızca sandbox köküne uygular.
 * Ana repo / master / production yazılmaz.
 */
export function applySandboxPatches(input: {
  projectSlug: string;
  sandboxRoot: string;
  patches: ProposedSandboxPatch[];
  commitSha?: string | null;
  maxPatches?: number;
}): SandboxPatchApplyResult {
  const maxPatches = input.maxPatches ?? 5;
  const applied: SandboxPatchApplyResult["applied"] = [];
  const rejected: Array<{ path: string; reason: string }> = [];
  const diffParts: string[] = [];

  const patches = input.patches.slice(0, maxPatches);
  for (const patch of patches) {
    const rel = patch.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const deny = isDeniedPath(rel);
    if (deny) {
      rejected.push({ path: rel, reason: deny });
      continue;
    }
    if (typeof patch.content !== "string" || patch.content.length > 80_000) {
      rejected.push({ path: rel, reason: "content_invalid_or_too_large" });
      continue;
    }
    try {
      const abs = assertInsideRoot(input.sandboxRoot, rel);
      const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      const beforeDigest = sha16(before);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, patch.content, "utf8");
      const after = patch.content;
      const afterDigest = sha16(after);
      const part = fileUnifiedDiff(rel, before, after);
      if (part) {
        diffParts.push(part);
        applied.push({
          path: rel,
          bytes: Buffer.byteLength(after),
          beforeDigest,
          afterDigest,
        });
      } else {
        rejected.push({ path: rel, reason: "no_content_change" });
      }
    } catch (err) {
      rejected.push({
        path: rel,
        reason: err instanceof Error ? err.message.slice(0, 120) : "apply_failed",
      });
    }
  }

  const diffText = diffParts.join("\n\n").slice(0, 100_000);
  const digest =
    diffText.length === 0
      ? "empty"
      : createHash("sha256").update(diffText).digest("hex").slice(0, 16);

  const digestSummary = applied
    .map((a) => `${a.path}:${a.beforeDigest}->${a.afterDigest}`)
    .join(";");

  const evidence: ToolEvidenceRecord = {
    kind: "sandbox_diff",
    projectSlug: input.projectSlug,
    path: applied.map((a) => a.path).join(",") || undefined,
    stdoutDigest: digest,
    commitSha: input.commitSha ?? null,
    summary:
      diffText.length === 0
        ? `sandbox_diff empty; rejected=${rejected.length}`
        : `sandbox_diff files=${applied.length} digest=${digest} fileDigests=${digestSummary}`.slice(
            0,
            2000,
          ),
    trusted: true,
    at: new Date().toISOString(),
  };

  return {
    ok: applied.length > 0 && diffText.length > 0,
    applied,
    rejected,
    diffText,
    evidence,
  };
}
