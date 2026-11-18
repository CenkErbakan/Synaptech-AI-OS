import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ProjectRepoBindingSchema,
  type ProjectRepoBinding,
} from "@synaptech/shared";

import { getPrisma } from "../../db/prisma.js";
import { repoRoot } from "../../lib/env.js";

function normalizeRepoUrl(url: string): string {
  return url.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
}

/** Yerel checkout origin'i beklenen GitHub URL ile birebir mi? */
export function verifyLocalCheckoutRemote(localRoot: string, expectedUrl: string): {
  ok: boolean;
  remote: string | null;
  headSha: string | null;
  reason?: string;
} {
  if (!existsSync(localRoot)) {
    return { ok: false, remote: null, headSha: null, reason: "local_root_missing" };
  }
  const remoteRes = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: localRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  const remote = (remoteRes.stdout || "").trim() || null;
  if (!remote) {
    return { ok: false, remote: null, headSha: null, reason: "git_remote_missing" };
  }
  if (normalizeRepoUrl(remote) !== normalizeRepoUrl(expectedUrl)) {
    return {
      ok: false,
      remote,
      headSha: null,
      reason: `remote_mismatch:${remote}`,
    };
  }
  const headRes = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: localRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  const headSha = (headRes.stdout || "").trim() || null;
  return { ok: true, remote, headSha };
}

export type BindingResolveSource = "mssql" | "proposed_unverified" | "test_fixture" | "none";

export type ResolvedProjectRepoBinding = ProjectRepoBinding & {
  source: BindingResolveSource;
  blockedReason: string | null;
};

const FIXTURES = new Map<string, ProjectRepoBinding>();

/** Yalnızca test — gerçek üretim bağını taklit eder. */
export function registerTestFixtureBinding(binding: ProjectRepoBinding): void {
  FIXTURES.set(binding.projectSlug, {
    ...binding,
    verified: true,
    verifiedBy: "test_fixture",
  });
}

export function clearTestFixtureBindings(): void {
  FIXTURES.clear();
}

function loadProposedFile(): ProjectRepoBinding[] {
  const candidates = [
    path.resolve(repoRoot(), "tasks/ops/project-repo-bindings.proposed.json"),
    path.resolve(process.cwd(), "../../tasks/ops/project-repo-bindings.proposed.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        bindings?: unknown[];
      };
      const out: ProjectRepoBinding[] = [];
      for (const row of raw.bindings ?? []) {
        const parsed = ProjectRepoBindingSchema.safeParse(row);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Proje → repo eşlemesi.
 * Doğrulanmayan bağlantı araç kullanımını engeller (tahmin yok).
 */
export async function resolveProjectRepoBinding(
  projectSlug: string,
): Promise<ResolvedProjectRepoBinding> {
  const fixture = FIXTURES.get(projectSlug);
  if (fixture) {
    return {
      ...fixture,
      source: "test_fixture",
      blockedReason: null,
    };
  }

  try {
    const prisma = getPrisma();
    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
      select: { githubRepoUrl: true, slug: true },
    });
    if (project?.githubRepoUrl) {
      const proposed = loadProposedFile().find((b) => b.projectSlug === projectSlug);
      let localReadRoot: string | null = null;
      const evidenceNotes = ["Project.githubRepoUrl MSSQL kaydı (Owner bağlı)"];
      if (proposed?.localReadRoot && proposed.verified === true && existsSync(proposed.localReadRoot)) {
        if (proposed.githubRepoUrl) {
          const check = verifyLocalCheckoutRemote(proposed.localReadRoot, proposed.githubRepoUrl);
          evidenceNotes.push(
            check.ok
              ? `local_remote_ok:${check.remote}`
              : `owner_file_local_root:${check.reason ?? "remote_unverified"}`,
          );
        } else {
          evidenceNotes.push("owner_file_local_root:no_github_url");
        }
        localReadRoot = proposed.localReadRoot;
      } else if (
        proposed?.localReadRoot &&
        proposed.githubRepoUrl &&
        normalizeRepoUrl(proposed.githubRepoUrl) === normalizeRepoUrl(project.githubRepoUrl)
      ) {
        const check = verifyLocalCheckoutRemote(proposed.localReadRoot, project.githubRepoUrl);
        if (check.ok) {
          localReadRoot = proposed.localReadRoot;
          evidenceNotes.push(
            `local_remote_ok:${check.remote}`,
            check.headSha ? `head:${check.headSha}` : "head:none",
          );
        } else {
          evidenceNotes.push(`local_remote_blocked:${check.reason ?? "fail"}`);
        }
      }
      const binding: ProjectRepoBinding = {
        projectSlug,
        githubRepoUrl: project.githubRepoUrl,
        localReadRoot,
        verified: true,
        verifiedBy: "mssql",
        evidenceNotes,
        readOnly: true,
        writeAllowed: false,
      };
      if (!localReadRoot) {
        return {
          ...binding,
          source: "mssql",
          blockedReason:
            "mssql_url_ok_but_local_read_root_unverified: uzak clone yok; yerel checkout remote eşleşmedi",
        };
      }
      return { ...binding, source: "mssql", blockedReason: null };
    }
  } catch {
    // DB yoksa proposed'a düş
  }

  const proposed = loadProposedFile().find((b) => b.projectSlug === projectSlug);
  if (proposed) {
    const verified = proposed.verified === true;
    return {
      ...proposed,
      verified,
      source: "proposed_unverified",
      blockedReason: verified
        ? null
        : "repo_binding_unverified: Owner doğrulaması yok; araçlar kapalı",
    };
  }

  return {
    projectSlug,
    githubRepoUrl: null,
    localReadRoot: null,
    verified: false,
    verifiedBy: "none",
    evidenceNotes: [],
    readOnly: true,
    writeAllowed: false,
    source: "none",
    blockedReason: "repo_binding_missing: proje için doğrulanmış GitHub/local bağ yok",
  };
}

export async function listProjectRepoBindings(): Promise<ResolvedProjectRepoBinding[]> {
  const slugs = ["synaptech", "subify", "marivo", "synaptech-ai-os"];
  return Promise.all(slugs.map((s) => resolveProjectRepoBinding(s)));
}
