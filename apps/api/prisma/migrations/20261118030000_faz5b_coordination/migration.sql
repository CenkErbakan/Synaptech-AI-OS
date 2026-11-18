BEGIN TRY
BEGIN TRAN;

ALTER TABLE [dbo].[Task] ADD [chainId] UNIQUEIDENTIFIER NULL;
ALTER TABLE [dbo].[Task] ADD [chainStep] NVARCHAR(32) NULL;
ALTER TABLE [dbo].[Task] ADD [chainOrder] INT NULL;
ALTER TABLE [dbo].[Task] ADD [dependsOnTaskId] UNIQUEIDENTIFIER NULL;
ALTER TABLE [dbo].[Task] ADD [workflowPhase] NVARCHAR(32) NULL;
ALTER TABLE [dbo].[Task] ADD [acceptanceCriteria] NVARCHAR(Max) NULL;
ALTER TABLE [dbo].[Task] ADD [executionResult] NVARCHAR(Max) NULL;
ALTER TABLE [dbo].[Task] ADD [executionKind] NVARCHAR(32) NULL;
ALTER TABLE [dbo].[Task] ADD [blockedReason] NVARCHAR(500) NULL;

ALTER TABLE [dbo].[AgentMessage] ADD [chainId] UNIQUEIDENTIFIER NULL;
ALTER TABLE [dbo].[AgentMessage] ADD [payloadJson] NVARCHAR(Max) NULL;

CREATE NONCLUSTERED INDEX [Task_chainId_chainOrder_idx] ON [dbo].[Task]([chainId], [chainOrder]);
CREATE NONCLUSTERED INDEX [Task_dependsOnTaskId_idx] ON [dbo].[Task]([dependsOnTaskId]);
CREATE NONCLUSTERED INDEX [Task_workflowPhase_status_idx] ON [dbo].[Task]([workflowPhase], [status]);
CREATE NONCLUSTERED INDEX [AgentMessage_chainId_createdAt_idx] ON [dbo].[AgentMessage]([chainId], [createdAt]);

ALTER TABLE [dbo].[Task] ADD CONSTRAINT [Task_dependsOnTaskId_fkey]
  FOREIGN KEY ([dependsOnTaskId]) REFERENCES [dbo].[Task]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW
END CATCH
