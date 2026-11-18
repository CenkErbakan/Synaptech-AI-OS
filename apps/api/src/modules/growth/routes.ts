import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireOwner } from "../../auth/context.js";
import { getPrisma } from "../../db/prisma.js";
import { createAdProposals } from "../../engines/ads-engine.js";
import { createContentDraftsFromSeo } from "../../engines/content-engine.js";
import {
  executeGrowthStep,
  runGrowthAutonomyCycle,
  simulateGrowthChain,
  startGrowthDeliveryChain,
} from "../../engines/growth-coordination.js";
import { runGrowthLeadResearch } from "../../engines/growth-engine.js";
import { runTechnicalSeoScan } from "../../engines/seo-engine.js";
import { parseLeadCrm } from "../../engines/crm-lead.js";
import { currentEpochStartedAt, epochActivityFilter } from "../../engines/operation-epoch.js";

export async function growthRoutes(app: FastifyInstance) {
  app.get("/api/growth/status", async (request) => {
    requireAuth(request);
    const prisma = getPrisma();
    const epochAt = await currentEpochStartedAt();
    const activity = epochActivityFilter(epochAt);
    const scanWhere = epochAt ? { startedAt: { gte: epochAt } } : {};
    const [leads, seo, drafts, ads, scans, legacySeo] = await Promise.all([
      prisma.lead.count({ where: activity }),
      prisma.seoFinding.count({ where: activity }),
      prisma.contentDraftRecord.count({ where: activity }),
      prisma.adProposal.count({ where: activity }),
      prisma.growthScanRun.findMany({ where: scanWhere, orderBy: { startedAt: "desc" }, take: 5 }),
      prisma.seoFinding.count(),
    ]);
    return {
      source: "api" as const,
      phase: "5C",
      realAiExecution: false,
      llmIntegrated: false,
      outreachEnabled: false,
      liveAdsEnabled: false,
      blogPublishEnabled: false,
      epochScoped: true,
      legacyHidden: Math.max(0, legacySeo - seo),
      counts: { leads, seoFindings: seo, drafts, adProposals: ads },
      recentScans: scans.map((s) => ({
        id: s.id,
        kind: s.kind,
        status: s.status,
        summary: s.summary,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
        errorMessage: s.errorMessage,
      })),
    };
  });

  app.get("/api/growth/leads", async (request) => {
    requireAuth(request);
    const epochAt = await currentEpochStartedAt();
    const leads = await getPrisma().lead.findMany({
      where: epochActivityFilter(epochAt),
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      source: "api" as const,
      realAiExecution: false,
      leads: leads.map((l) => ({
        id: l.id,
        companyName: l.companyName,
        websiteUrl: l.websiteUrl,
        segment: l.segment,
        needSignal: l.needSignal,
        sourceUrl: l.sourceUrl,
        sourceKind: l.sourceKind,
        confidenceScore: l.confidenceScore,
        verified: l.verified,
        verifiedAt: l.verifiedAt?.toISOString() ?? null,
        status: l.status,
        notes: l.notes,
        createdAt: l.createdAt.toISOString(),
        crm: parseLeadCrm(l.notes),
      })),
    };
  });

  app.get("/api/growth/seo-findings", async (request) => {
    requireAuth(request);
    const epochAt = await currentEpochStartedAt();
    const findings = await getPrisma().seoFinding.findMany({
      where: epochActivityFilter(epochAt),
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      source: "api" as const,
      gscConnected: false,
      ga4Connected: false,
      findings,
    };
  });

  app.get("/api/growth/content-drafts", async (request) => {
    requireAuth(request);
    const epochAt = await currentEpochStartedAt();
    const drafts = await getPrisma().contentDraftRecord.findMany({
      where: epochActivityFilter(epochAt),
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      source: "api" as const,
      llmArticleGenerated: false,
      drafts: drafts.map((d) => ({
        id: d.id,
        locale: d.locale,
        title: d.title,
        slug: d.slug,
        metaDescription: d.metaDescription,
        status: d.status,
        contentKind: d.contentKind,
        seoReview: d.seoReview,
        publishApproval: d.publishApproval,
        qualityNotes: d.qualityNotes,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/growth/ad-proposals", async (request) => {
    requireAuth(request);
    const epochAt = await currentEpochStartedAt();
    const proposals = await getPrisma().adProposal.findMany({
      where: epochActivityFilter(epochAt),
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      source: "api" as const,
      liveLaunch: false,
      proposals: proposals.map((p) => ({
        id: p.id,
        platform: p.platform,
        campaignName: p.campaignName,
        objective: p.objective,
        audienceSummary: p.audienceSummary,
        headline: p.headline,
        primaryText: p.primaryText,
        suggestedDailyBudgetTry: p.suggestedDailyBudgetTry
          ? Number(p.suggestedDailyBudgetTry)
          : null,
        status: p.status,
        liveLaunch: p.liveLaunch,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });

  app.post("/api/growth/research/leads", async (request) => {
    requireOwner(request);
    return { source: "api" as const, ...(await runGrowthLeadResearch()) };
  });

  app.post("/api/growth/seo/scan", async (request) => {
    requireOwner(request);
    return { source: "api" as const, ...(await runTechnicalSeoScan()) };
  });

  app.post("/api/growth/content/drafts", async (request) => {
    requireOwner(request);
    return { source: "api" as const, ...(await createContentDraftsFromSeo()) };
  });

  app.post("/api/growth/ads/proposals", async (request) => {
    requireOwner(request);
    return { source: "api" as const, ...(await createAdProposals()) };
  });

  app.post("/api/growth/chains/start", async (request) => {
    requireOwner(request);
    const body = z
      .object({
        idempotencyKey: z.string().min(8).max(120),
        title: z.string().max(140).optional(),
      })
      .parse(request.body ?? {});
    return { source: "api" as const, ...(await startGrowthDeliveryChain(body)) };
  });

  app.post("/api/growth/steps/:taskId/execute", async (request) => {
    requireOwner(request);
    const { taskId } = request.params as { taskId: string };
    return { source: "api" as const, ...(await executeGrowthStep(taskId)) };
  });

  app.post("/api/growth/chains/:chainId/simulate", async (request) => {
    requireOwner(request);
    const { chainId } = request.params as { chainId: string };
    return { source: "api" as const, ...(await simulateGrowthChain(chainId)) };
  });

  app.post("/api/growth/cycle", async (request) => {
    requireOwner(request);
    return { source: "api" as const, ...(await runGrowthAutonomyCycle()) };
  });
}
