BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Project] ADD [githubRepoUrl] NVARCHAR(500) NULL;

-- AlterTable
ALTER TABLE [dbo].[Project] ADD [cloudAgentEnabled] BIT NOT NULL CONSTRAINT [Project_cloudAgentEnabled_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
