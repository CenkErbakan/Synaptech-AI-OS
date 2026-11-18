BEGIN TRY
BEGIN TRAN;

-- AlterTable Task
ALTER TABLE [dbo].[Task] ADD [parentTaskId] UNIQUEIDENTIFIER NULL;
ALTER TABLE [dbo].[Task] ADD [executionPolicy] NVARCHAR(32) NULL;
ALTER TABLE [dbo].[Task] ADD [origin] NVARCHAR(120) NULL;

-- AlterTable AgentRun
ALTER TABLE [dbo].[AgentRun] ADD [reconcileState] NVARCHAR(32) NULL;
ALTER TABLE [dbo].[AgentRun] ADD [staleAt] DATETIME2 NULL;
ALTER TABLE [dbo].[AgentRun] ADD [lastReconciledAt] DATETIME2 NULL;

-- CreateTable CompanyGoal
CREATE TABLE [dbo].[CompanyGoal] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [CompanyGoal_id_df] DEFAULT NEWSEQUENTIALID(),
    [goalKey] NVARCHAR(64) NOT NULL,
    [projectSlug] NVARCHAR(64) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(Max) NOT NULL,
    [priority] NVARCHAR(16) NOT NULL CONSTRAINT [CompanyGoal_priority_df] DEFAULT 'medium',
    [kpiLabel] NVARCHAR(120) NOT NULL,
    [targetValue] NVARCHAR(120) NULL,
    [currentValue] NVARCHAR(120) NULL,
    [dataSource] NVARCHAR(200) NOT NULL,
    [department] NVARCHAR(80) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [CompanyGoal_status_df] DEFAULT 'active',
    [lastEvaluatedAt] DATETIME2 NULL,
    [nextEvaluateAt] DATETIME2 NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CompanyGoal_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CompanyGoal_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CompanyGoal_goalKey_key] UNIQUE NONCLUSTERED ([goalKey])
);

-- CreateTable Opportunity
CREATE TABLE [dbo].[Opportunity] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [Opportunity_id_df] DEFAULT NEWSEQUENTIALID(),
    [title] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(Max) NOT NULL,
    [projectSlug] NVARCHAR(64) NOT NULL,
    [sourceKind] NVARCHAR(64) NOT NULL,
    [evidenceRef] NVARCHAR(500) NULL,
    [commercialValue] NVARCHAR(40) NOT NULL,
    [confidence] NVARCHAR(40) NOT NULL,
    [estimatedEffort] NVARCHAR(40) NOT NULL,
    [estimatedAiCost] NVARCHAR(40) NOT NULL,
    [securityRisk] NVARCHAR(16) NOT NULL,
    [suggestedAgentId] NVARCHAR(64) NOT NULL,
    [suggestedNextStep] NVARCHAR(500) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [Opportunity_status_df] DEFAULT 'open',
    [verified] BIT NOT NULL CONSTRAINT [Opportunity_verified_df] DEFAULT 0,
    [dedupeHash] NVARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Opportunity_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Opportunity_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Opportunity_dedupeHash_key] UNIQUE NONCLUSTERED ([dedupeHash])
);

-- CreateTable AutonomyPolicy
CREATE TABLE [dbo].[AutonomyPolicy] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [AutonomyPolicy_id_df] DEFAULT NEWSEQUENTIALID(),
    [policyKey] NVARCHAR(80) NOT NULL,
    [actionType] NVARCHAR(80) NOT NULL,
    [projectSlug] NVARCHAR(64) NULL,
    [repositoryUrl] NVARCHAR(500) NULL,
    [authority] NVARCHAR(32) NOT NULL,
    [maxRisk] NVARCHAR(16) NOT NULL,
    [maxUsageTokens] INT NULL,
    [expiresAt] DATETIME2 NULL,
    [enabled] BIT NOT NULL CONSTRAINT [AutonomyPolicy_enabled_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AutonomyPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AutonomyPolicy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AutonomyPolicy_policyKey_key] UNIQUE NONCLUSTERED ([policyKey])
);

-- CreateTable ScheduledJob
CREATE TABLE [dbo].[ScheduledJob] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [ScheduledJob_id_df] DEFAULT NEWSEQUENTIALID(),
    [jobKey] NVARCHAR(80) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [cronExpr] NVARCHAR(80) NOT NULL,
    [timezone] NVARCHAR(64) NOT NULL CONSTRAINT [ScheduledJob_timezone_df] DEFAULT 'Europe/Istanbul',
    [enabled] BIT NOT NULL CONSTRAINT [ScheduledJob_enabled_df] DEFAULT 1,
    [handler] NVARCHAR(80) NOT NULL,
    [timeoutSec] INT NOT NULL CONSTRAINT [ScheduledJob_timeoutSec_df] DEFAULT 120,
    [maxRetries] INT NOT NULL CONSTRAINT [ScheduledJob_maxRetries_df] DEFAULT 1,
    [lastStartedAt] DATETIME2 NULL,
    [lastFinishedAt] DATETIME2 NULL,
    [lastStatus] NVARCHAR(40) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScheduledJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ScheduledJob_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ScheduledJob_jobKey_key] UNIQUE NONCLUSTERED ([jobKey])
);

-- CreateTable ScheduledJobRun
CREATE TABLE [dbo].[ScheduledJobRun] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [ScheduledJobRun_id_df] DEFAULT NEWSEQUENTIALID(),
    [jobId] UNIQUEIDENTIFIER NOT NULL,
    [idempotencyKey] NVARCHAR(128) NOT NULL,
    [status] NVARCHAR(40) NOT NULL,
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [ScheduledJobRun_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [finishedAt] DATETIME2 NULL,
    [message] NVARCHAR(1000) NULL,
    [resultJson] NVARCHAR(Max) NULL,
    CONSTRAINT [ScheduledJobRun_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ScheduledJobRun_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable AgentMessage
CREATE TABLE [dbo].[AgentMessage] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [AgentMessage_id_df] DEFAULT NEWSEQUENTIALID(),
    [fromAgentId] NVARCHAR(64) NOT NULL,
    [toAgentId] NVARCHAR(64) NOT NULL,
    [taskId] UNIQUEIDENTIFIER NULL,
    [parentTaskId] UNIQUEIDENTIFIER NULL,
    [kind] NVARCHAR(40) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    [evidenceRef] NVARCHAR(500) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AgentMessage_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentMessage_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- Indexes
CREATE NONCLUSTERED INDEX [Task_parentTaskId_idx] ON [dbo].[Task]([parentTaskId]);
CREATE NONCLUSTERED INDEX [AgentRun_executionMode_cursorStatus_idx] ON [dbo].[AgentRun]([executionMode], [cursorStatus]);
CREATE NONCLUSTERED INDEX [AgentRun_reconcileState_idx] ON [dbo].[AgentRun]([reconcileState]);
CREATE NONCLUSTERED INDEX [CompanyGoal_projectSlug_status_idx] ON [dbo].[CompanyGoal]([projectSlug], [status]);
CREATE NONCLUSTERED INDEX [CompanyGoal_nextEvaluateAt_idx] ON [dbo].[CompanyGoal]([nextEvaluateAt]);
CREATE NONCLUSTERED INDEX [Opportunity_projectSlug_status_idx] ON [dbo].[Opportunity]([projectSlug], [status]);
CREATE NONCLUSTERED INDEX [Opportunity_createdAt_idx] ON [dbo].[Opportunity]([createdAt]);
CREATE NONCLUSTERED INDEX [AutonomyPolicy_authority_enabled_idx] ON [dbo].[AutonomyPolicy]([authority], [enabled]);
CREATE NONCLUSTERED INDEX [ScheduledJobRun_jobId_startedAt_idx] ON [dbo].[ScheduledJobRun]([jobId], [startedAt]);
CREATE NONCLUSTERED INDEX [AgentMessage_createdAt_idx] ON [dbo].[AgentMessage]([createdAt]);
CREATE NONCLUSTERED INDEX [AgentMessage_taskId_idx] ON [dbo].[AgentMessage]([taskId]);
CREATE NONCLUSTERED INDEX [AgentMessage_fromAgentId_toAgentId_idx] ON [dbo].[AgentMessage]([fromAgentId], [toAgentId]);

-- FKs
ALTER TABLE [dbo].[Task] ADD CONSTRAINT [Task_parentTaskId_fkey] FOREIGN KEY ([parentTaskId]) REFERENCES [dbo].[Task]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ScheduledJobRun] ADD CONSTRAINT [ScheduledJobRun_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[ScheduledJob]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[AgentMessage] ADD CONSTRAINT [AgentMessage_taskId_fkey] FOREIGN KEY ([taskId]) REFERENCES [dbo].[Task]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW
END CATCH
