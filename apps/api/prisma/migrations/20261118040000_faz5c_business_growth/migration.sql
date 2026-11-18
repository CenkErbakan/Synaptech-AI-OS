BEGIN TRY
BEGIN TRAN;

CREATE TABLE [dbo].[Lead] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [Lead_id_df] DEFAULT NEWSEQUENTIALID(),
    [companyName] NVARCHAR(200) NOT NULL,
    [websiteUrl] NVARCHAR(500) NULL,
    [segment] NVARCHAR(120) NOT NULL,
    [needSignal] NVARCHAR(500) NOT NULL,
    [sourceUrl] NVARCHAR(500) NULL,
    [sourceKind] NVARCHAR(64) NOT NULL,
    [confidenceScore] INT NOT NULL CONSTRAINT [Lead_confidenceScore_df] DEFAULT 0,
    [verified] BIT NOT NULL CONSTRAINT [Lead_verified_df] DEFAULT 0,
    [verifiedAt] DATETIME2 NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [Lead_status_df] DEFAULT 'new',
    [dedupeHash] NVARCHAR(64) NOT NULL,
    [notes] NVARCHAR(1000) NULL,
    [projectSlug] NVARCHAR(64) NOT NULL CONSTRAINT [Lead_projectSlug_df] DEFAULT 'synaptech',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Lead_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Lead_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Lead_dedupeHash_key] UNIQUE NONCLUSTERED ([dedupeHash])
);

CREATE TABLE [dbo].[SeoFinding] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [SeoFinding_id_df] DEFAULT NEWSEQUENTIALID(),
    [projectSlug] NVARCHAR(64) NOT NULL,
    [pageUrl] NVARCHAR(500) NOT NULL,
    [category] NVARCHAR(64) NOT NULL,
    [findingKind] NVARCHAR(32) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [detail] NVARCHAR(Max) NOT NULL,
    [evidenceRef] NVARCHAR(500) NULL,
    [httpStatus] INT NULL,
    [severity] NVARCHAR(16) NOT NULL CONSTRAINT [SeoFinding_severity_df] DEFAULT 'info',
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [SeoFinding_status_df] DEFAULT 'open',
    [dedupeHash] NVARCHAR(64) NOT NULL,
    [scanRunId] UNIQUEIDENTIFIER NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SeoFinding_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SeoFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SeoFinding_dedupeHash_key] UNIQUE NONCLUSTERED ([dedupeHash])
);

CREATE TABLE [dbo].[ContentDraftRecord] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [ContentDraftRecord_id_df] DEFAULT NEWSEQUENTIALID(),
    [projectSlug] NVARCHAR(64) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [slug] NVARCHAR(200) NOT NULL,
    [metaDescription] NVARCHAR(200) NOT NULL,
    [outlineJson] NVARCHAR(Max) NULL,
    [bodyTemplate] NVARCHAR(Max) NULL,
    [sourcesJson] NVARCHAR(Max) NULL,
    [seoFindingId] UNIQUEIDENTIFIER NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [ContentDraftRecord_status_df] DEFAULT 'draft',
    [seoReview] NVARCHAR(40) NOT NULL CONSTRAINT [ContentDraftRecord_seoReview_df] DEFAULT 'pending',
    [publishApproval] NVARCHAR(40) NOT NULL CONSTRAINT [ContentDraftRecord_publishApproval_df] DEFAULT 'pending',
    [contentKind] NVARCHAR(32) NOT NULL CONSTRAINT [ContentDraftRecord_contentKind_df] DEFAULT 'template',
    [qualityNotes] NVARCHAR(1000) NULL,
    [dedupeHash] NVARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ContentDraftRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ContentDraftRecord_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ContentDraftRecord_dedupeHash_key] UNIQUE NONCLUSTERED ([dedupeHash]),
    CONSTRAINT [ContentDraftRecord_projectSlug_locale_slug_key] UNIQUE NONCLUSTERED ([projectSlug], [locale], [slug])
);

CREATE TABLE [dbo].[AdProposal] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [AdProposal_id_df] DEFAULT NEWSEQUENTIALID(),
    [projectSlug] NVARCHAR(64) NOT NULL,
    [platform] NVARCHAR(40) NOT NULL,
    [campaignName] NVARCHAR(200) NOT NULL,
    [objective] NVARCHAR(120) NOT NULL,
    [audienceSummary] NVARCHAR(500) NOT NULL,
    [headline] NVARCHAR(200) NOT NULL,
    [primaryText] NVARCHAR(1000) NOT NULL,
    [suggestedDailyBudgetTry] DECIMAL(12,2) NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [AdProposal_status_df] DEFAULT 'draft_proposal',
    [liveLaunch] BIT NOT NULL CONSTRAINT [AdProposal_liveLaunch_df] DEFAULT 0,
    [notes] NVARCHAR(1000) NULL,
    [dedupeHash] NVARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AdProposal_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AdProposal_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AdProposal_dedupeHash_key] UNIQUE NONCLUSTERED ([dedupeHash])
);

CREATE TABLE [dbo].[GrowthScanRun] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [GrowthScanRun_id_df] DEFAULT NEWSEQUENTIALID(),
    [kind] NVARCHAR(40) NOT NULL,
    [status] NVARCHAR(40) NOT NULL,
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [GrowthScanRun_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [finishedAt] DATETIME2 NULL,
    [summary] NVARCHAR(1000) NULL,
    [evidenceJson] NVARCHAR(Max) NULL,
    [errorMessage] NVARCHAR(1000) NULL,
    [chainId] UNIQUEIDENTIFIER NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [GrowthScanRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [GrowthScanRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [Lead_status_createdAt_idx] ON [dbo].[Lead]([status], [createdAt]);
CREATE NONCLUSTERED INDEX [Lead_segment_idx] ON [dbo].[Lead]([segment]);
CREATE NONCLUSTERED INDEX [Lead_verified_confidenceScore_idx] ON [dbo].[Lead]([verified], [confidenceScore]);
CREATE NONCLUSTERED INDEX [SeoFinding_projectSlug_status_idx] ON [dbo].[SeoFinding]([projectSlug], [status]);
CREATE NONCLUSTERED INDEX [SeoFinding_findingKind_category_idx] ON [dbo].[SeoFinding]([findingKind], [category]);
CREATE NONCLUSTERED INDEX [SeoFinding_createdAt_idx] ON [dbo].[SeoFinding]([createdAt]);
CREATE NONCLUSTERED INDEX [ContentDraftRecord_projectSlug_locale_status_idx] ON [dbo].[ContentDraftRecord]([projectSlug], [locale], [status]);
CREATE NONCLUSTERED INDEX [ContentDraftRecord_slug_idx] ON [dbo].[ContentDraftRecord]([slug]);
CREATE NONCLUSTERED INDEX [AdProposal_projectSlug_status_idx] ON [dbo].[AdProposal]([projectSlug], [status]);
CREATE NONCLUSTERED INDEX [AdProposal_platform_idx] ON [dbo].[AdProposal]([platform]);
CREATE NONCLUSTERED INDEX [GrowthScanRun_kind_startedAt_idx] ON [dbo].[GrowthScanRun]([kind], [startedAt]);
CREATE NONCLUSTERED INDEX [GrowthScanRun_status_idx] ON [dbo].[GrowthScanRun]([status]);

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW
END CATCH
