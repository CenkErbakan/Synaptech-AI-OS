import type {
  AgentFrontmatter,
  AgentRegistryEntry,
  AuditEvent,
  ContentDraftFrontmatter,
  DocumentFrontmatter,
  GuardPolicy,
  KillSwitch,
  SystemStatus,
} from "@synaptech/shared";

export type LoadResult<T> =
  | { ok: true; data: T; path: string }
  | { ok: false; error: string; path: string };

export interface GuardStatus {
  hooksInstalled: boolean;
  mode: "enforce" | "observe" | "none";
  events: string[];
  policy: GuardPolicy | null;
  policyError?: string;
  hooksError?: string;
}

export interface ActiveSubagent {
  source: "cursor-hook";
  id: string;
  type: string;
  model?: string;
  task?: string;
  startedAt: string;
}

export interface AuditSummary {
  events: AuditEvent[];
  files: string[];
  invalidLines: number;
}

export interface SystemSnapshot {
  generatedAt: string;
  systemStatus: LoadResult<SystemStatus>;
  killSwitch: LoadResult<KillSwitch>;
  guard: GuardStatus;
  activeSubagents: ActiveSubagent[];
  subagentStateError?: string;
  audit: AuditSummary;
}

export interface AgentDirectoryEntry extends AgentRegistryEntry {
  departmentName: string;
  definition: {
    path: string;
    exists: boolean;
    frontmatter: AgentFrontmatter | null;
    error?: string;
  };
}

export type DocumentArea = "reports" | "content" | "marketing" | "tasks";

export interface RepoDocument {
  source: "repo-file";
  path: string;
  area: DocumentArea;
  title: string;
  frontmatter: DocumentFrontmatter;
  modifiedAt: string;
}

export interface ContentDraftFile {
  source: "repo-file";
  path: string;
  lang: "tr" | "en";
  title: string;
  frontmatter: ContentDraftFrontmatter | null;
  error?: string;
  modifiedAt: string;
}
