BEGIN TRY
BEGIN TRAN;

CREATE TABLE [dbo].[WorkerLease] (
    [lockKey] NVARCHAR(120) NOT NULL,
    [holderId] NVARCHAR(120) NOT NULL,
    [acquiredAt] DATETIME2 NOT NULL CONSTRAINT [WorkerLease_acquiredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [heartbeatAt] DATETIME2 NOT NULL CONSTRAINT [WorkerLease_heartbeatAt_df] DEFAULT CURRENT_TIMESTAMP,
    [metaJson] NVARCHAR(Max) NULL,
    CONSTRAINT [WorkerLease_pkey] PRIMARY KEY CLUSTERED ([lockKey])
);

CREATE TABLE [dbo].[WorkerInstance] (
    [id] NVARCHAR(120) NOT NULL,
    [role] NVARCHAR(40) NOT NULL,
    [hostname] NVARCHAR(200) NULL,
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [WorkerInstance_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [WorkerInstance_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [WorkerInstance_status_df] DEFAULT 'starting',
    [stopReason] NVARCHAR(500) NULL,
    [metaJson] NVARCHAR(Max) NULL,
    CONSTRAINT [WorkerInstance_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [WorkerLease_expiresAt_idx] ON [dbo].[WorkerLease]([expiresAt]);
CREATE NONCLUSTERED INDEX [WorkerLease_holderId_idx] ON [dbo].[WorkerLease]([holderId]);
CREATE NONCLUSTERED INDEX [WorkerInstance_status_lastSeenAt_idx] ON [dbo].[WorkerInstance]([status], [lastSeenAt]);
CREATE NONCLUSTERED INDEX [WorkerInstance_role_idx] ON [dbo].[WorkerInstance]([role]);

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW
END CATCH
