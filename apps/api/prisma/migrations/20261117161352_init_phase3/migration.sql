BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [role] NVARCHAR(40) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Agent] (
    [id] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [role] NVARCHAR(120) NOT NULL,
    [department] NVARCHAR(80) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [Agent_enabled_df] DEFAULT 1,
    [readonlyRole] BIT NOT NULL CONSTRAINT [Agent_readonlyRole_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Agent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Agent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Project] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [slug] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [description] NVARCHAR(max),
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [Project_status_df] DEFAULT 'active',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Project_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Project_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Project_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[Task] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [source] NVARCHAR(16) NOT NULL CONSTRAINT [Task_source_df] DEFAULT 'real',
    [title] NVARCHAR(140) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    [projectId] UNIQUEIDENTIFIER NOT NULL,
    [assigneeId] NVARCHAR(64) NOT NULL,
    [priority] NVARCHAR(16) NOT NULL CONSTRAINT [Task_priority_df] DEFAULT 'medium',
    [status] NVARCHAR(32) NOT NULL CONSTRAINT [Task_status_df] DEFAULT 'backlog',
    [paused] BIT NOT NULL CONSTRAINT [Task_paused_df] DEFAULT 0,
    [attempts] INT NOT NULL CONSTRAINT [Task_attempts_df] DEFAULT 0,
    [timeoutMinutes] INT NOT NULL CONSTRAINT [Task_timeoutMinutes_df] DEFAULT 60,
    [dueAt] DATETIME2,
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [dispatchState] NVARCHAR(40) NOT NULL CONSTRAINT [Task_dispatchState_df] DEFAULT 'not_applicable',
    [idempotencyKey] NVARCHAR(128),
    [approvalId] UNIQUEIDENTIFIER,
    [model] NVARCHAR(120),
    [gitBranch] NVARCHAR(200),
    [gitPrUrl] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Task_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Task_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Task_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[TaskEvent] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [taskId] UNIQUEIDENTIFIER NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [TaskEvent_at_df] DEFAULT CURRENT_TIMESTAMP,
    [actorKind] NVARCHAR(16) NOT NULL,
    [actorAgent] NVARCHAR(64),
    [type] NVARCHAR(40) NOT NULL,
    [message] NVARCHAR(1000) NOT NULL,
    [fromStatus] NVARCHAR(32),
    [toStatus] NVARCHAR(32),
    CONSTRAINT [TaskEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TaskAssignment] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [taskId] UNIQUEIDENTIFIER NOT NULL,
    [agentId] NVARCHAR(64) NOT NULL,
    [assignedAt] DATETIME2 NOT NULL CONSTRAINT [TaskAssignment_assignedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [note] NVARCHAR(500),
    CONSTRAINT [TaskAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Approval] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [source] NVARCHAR(16) NOT NULL CONSTRAINT [Approval_source_df] DEFAULT 'real',
    [type] NVARCHAR(64) NOT NULL,
    [requestedBy] NVARCHAR(64) NOT NULL,
    [projectId] UNIQUEIDENTIFIER NOT NULL,
    [taskId] UNIQUEIDENTIFIER,
    [title] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    [changeSummary] NVARCHAR(max) NOT NULL,
    [risk] NVARCHAR(16) NOT NULL,
    [subjectKind] NVARCHAR(40) NOT NULL,
    [subjectRef] NVARCHAR(500) NOT NULL,
    [subjectVersion] NVARCHAR(200) NOT NULL,
    [currentVersion] NVARCHAR(200) NOT NULL,
    [status] NVARCHAR(32) NOT NULL CONSTRAINT [Approval_status_df] DEFAULT 'pending',
    [decidedById] UNIQUEIDENTIFIER,
    [decidedAt] DATETIME2,
    [decisionNote] NVARCHAR(1000),
    [boundVersion] NVARCHAR(200),
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Approval_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Approval_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalEvent] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [approvalId] UNIQUEIDENTIFIER NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [ApprovalEvent_at_df] DEFAULT CURRENT_TIMESTAMP,
    [actorKind] NVARCHAR(16) NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [message] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [ApprovalEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AgentRun] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [taskId] UNIQUEIDENTIFIER NOT NULL,
    [agentId] NVARCHAR(64) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [AgentRun_status_df] DEFAULT 'awaiting_integration',
    [externalId] NVARCHAR(200),
    [message] NVARCHAR(1000),
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AgentRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [AuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    [category] NVARCHAR(64) NOT NULL,
    [action] NVARCHAR(120) NOT NULL,
    [actorKind] NVARCHAR(16) NOT NULL,
    [actorAgent] NVARCHAR(64),
    [userId] UNIQUEIDENTIFIER,
    [targetType] NVARCHAR(64),
    [targetId] NVARCHAR(200),
    [summary] NVARCHAR(1000) NOT NULL,
    [metadata] NVARCHAR(max),
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SystemSetting] (
    [key] NVARCHAR(120) NOT NULL,
    [value] NVARCHAR(max) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    [updatedBy] NVARCHAR(120),
    CONSTRAINT [SystemSetting_pkey] PRIMARY KEY CLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[IntegrationConnection] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [provider] NVARCHAR(64) NOT NULL,
    [status] NVARCHAR(40) NOT NULL,
    [detail] NVARCHAR(500),
    [updatedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IntegrationConnection_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IntegrationConnection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IntegrationConnection_provider_key] UNIQUE NONCLUSTERED ([provider])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Task_status_updatedAt_idx] ON [dbo].[Task]([status], [updatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Task_assigneeId_status_idx] ON [dbo].[Task]([assigneeId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Task_projectId_idx] ON [dbo].[Task]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TaskEvent_taskId_at_idx] ON [dbo].[TaskEvent]([taskId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TaskAssignment_agentId_assignedAt_idx] ON [dbo].[TaskAssignment]([agentId], [assignedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Approval_status_createdAt_idx] ON [dbo].[Approval]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Approval_projectId_idx] ON [dbo].[Approval]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalEvent_approvalId_at_idx] ON [dbo].[ApprovalEvent]([approvalId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AgentRun_taskId_idx] ON [dbo].[AgentRun]([taskId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AgentRun_agentId_createdAt_idx] ON [dbo].[AgentRun]([agentId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_at_idx] ON [dbo].[AuditLog]([at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_category_at_idx] ON [dbo].[AuditLog]([category], [at]);

-- AddForeignKey
ALTER TABLE [dbo].[Task] ADD CONSTRAINT [Task_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[Project]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Task] ADD CONSTRAINT [Task_assigneeId_fkey] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaskEvent] ADD CONSTRAINT [TaskEvent_taskId_fkey] FOREIGN KEY ([taskId]) REFERENCES [dbo].[Task]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaskAssignment] ADD CONSTRAINT [TaskAssignment_taskId_fkey] FOREIGN KEY ([taskId]) REFERENCES [dbo].[Task]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaskAssignment] ADD CONSTRAINT [TaskAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [Approval_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[Project]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [Approval_decidedById_fkey] FOREIGN KEY ([decidedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalEvent] ADD CONSTRAINT [ApprovalEvent_approvalId_fkey] FOREIGN KEY ([approvalId]) REFERENCES [dbo].[Approval]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AgentRun] ADD CONSTRAINT [AgentRun_taskId_fkey] FOREIGN KEY ([taskId]) REFERENCES [dbo].[Task]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AgentRun] ADD CONSTRAINT [AgentRun_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
