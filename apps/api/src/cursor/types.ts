import { z } from "zod";
import { CursorRunStatusSchema } from "@synaptech/shared";

export const CursorApiErrorBodySchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export const CursorAgentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z.enum(["ACTIVE", "IDLE", "ARCHIVED"]),
  url: z.string().url().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  latestRunId: z.string().optional(),
  repos: z
    .array(
      z.object({
        url: z.string(),
        startingRef: z.string().optional(),
        prUrl: z.string().optional(),
      }),
    )
    .optional(),
  autoCreatePR: z.boolean().optional(),
  workOnCurrentBranch: z.boolean().optional(),
});

export const CursorRunSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  status: CursorRunStatusSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  durationMs: z.number().optional(),
  result: z.string().optional(),
  git: z
    .object({
      branches: z
        .array(
          z.object({
            repoUrl: z.string(),
            branch: z.string().optional(),
            prUrl: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export const CursorCreateAgentResponseSchema = z.object({
  agent: CursorAgentSchema,
  run: CursorRunSchema,
});

export const CursorUsageSchema = z.object({
  totalUsage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheWriteTokens: z.number(),
    cacheReadTokens: z.number(),
    totalTokens: z.number(),
  }),
  runs: z.array(
    z.object({
      id: z.string(),
      usageUuid: z.string().optional(),
      usage: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheWriteTokens: z.number(),
        cacheReadTokens: z.number(),
        totalTokens: z.number(),
      }),
    }),
  ),
});

export type CursorAgent = z.infer<typeof CursorAgentSchema>;
export type CursorRun = z.infer<typeof CursorRunSchema>;
export type CursorCreateAgentResponse = z.infer<typeof CursorCreateAgentResponseSchema>;
export type CursorUsage = z.infer<typeof CursorUsageSchema>;

export interface CreateAgentInput {
  promptText: string;
  repositoryUrl: string;
  startingRef?: string;
  /** Client-supplied bc-<uuid> for idempotency. */
  agentId?: string;
  name?: string;
  modelId?: string;
  autoCreatePR?: boolean;
  workOnCurrentBranch?: boolean;
}

export interface CursorCloudClient {
  readonly mode: "mock" | "live";
  createAgent(input: CreateAgentInput): Promise<CursorCreateAgentResponse>;
  getAgent(agentId: string): Promise<CursorAgent>;
  getRun(agentId: string, runId: string): Promise<CursorRun>;
  listRuns(agentId: string): Promise<CursorRun[]>;
  cancelRun(agentId: string, runId: string): Promise<{ id: string }>;
  getUsage(agentId: string, runId?: string): Promise<CursorUsage | null>;
  /** Bağlantı doğrulama — list agents ile hafif GET. Mock'ta her zaman ok. */
  verifyConnection(): Promise<{ ok: boolean; message: string }>;
}

export class CursorApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "CursorApiError";
  }
}
