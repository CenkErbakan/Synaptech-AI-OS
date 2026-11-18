BEGIN TRY

BEGIN TRAN;

-- AlterTable: Faz 4A Cloud run alanları
-- Not: SQL Server aynı batch'te yeni eklenen kolonu CREATE INDEX'te derleyemez (hata 207).
-- Bu yüzden index'ler dinamik SQL (EXEC) ile oluşturulur.
ALTER TABLE [dbo].[AgentRun] ADD
    [cursorAgentId] NVARCHAR(120) NULL,
    [cursorRunId] NVARCHAR(120) NULL,
    [githubRepository] NVARCHAR(500) NULL,
    [branch] NVARCHAR(200) NULL,
    [model] NVARCHAR(120) NULL,
    [cursorStatus] NVARCHAR(64) NULL,
    [errorMessage] NVARCHAR(1000) NULL,
    [resultSummary] NVARCHAR(Max) NULL,
    [prUrl] NVARCHAR(500) NULL,
    [agentUrl] NVARCHAR(500) NULL,
    [executionMode] NVARCHAR(16) NULL,
    [approvalId] UNIQUEIDENTIFIER NULL,
    [idempotencyKey] NVARCHAR(128) NULL,
    [inputTokens] INT NULL,
    [outputTokens] INT NULL,
    [totalTokens] INT NULL,
    [cancelVerified] BIT NOT NULL CONSTRAINT [AgentRun_cancelVerified_df] DEFAULT 0;

-- Filtered unique index: birden fazla NULL serbest; aynı dolu idempotencyKey engellenir.
EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [AgentRun_idempotencyKey_key]
  ON [dbo].[AgentRun]([idempotencyKey])
  WHERE [idempotencyKey] IS NOT NULL');

EXEC(N'CREATE NONCLUSTERED INDEX [AgentRun_cursorAgentId_idx] ON [dbo].[AgentRun]([cursorAgentId])');
EXEC(N'CREATE NONCLUSTERED INDEX [AgentRun_cursorRunId_idx] ON [dbo].[AgentRun]([cursorRunId])');
EXEC(N'CREATE NONCLUSTERED INDEX [AgentRun_status_createdAt_idx] ON [dbo].[AgentRun]([status], [createdAt])');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
