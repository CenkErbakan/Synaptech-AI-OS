import { createHash } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { killSwitchActive } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";

function dedupe(parts: string[]): string {
  return createHash("sha256").update(parts.join("|").toLowerCase(), "utf8").digest("hex").slice(0, 64);
}

export interface AdsProposalResult {
  mode: "proposal_only";
  realAiExecution: false;
  liveLaunch: false;
  spendPerformed: false;
  created: Array<{ id: string; platform: string; campaignName: string }>;
  skippedDuplicates: number;
}

/**
 * Reklam kampanya önerisi / metin taslağı / bütçe planı.
 * Gerçek yayın veya harcama YOK.
 */
export async function createAdProposals(input?: {
  chainId?: string | null;
}): Promise<AdsProposalResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: ads proposal yok.");

  const prisma = getPrisma();
  const proposals = [
    {
      platform: "google_ads",
      campaignName: "SynapTech — KOBİ CRM arama (öneri)",
      objective: "lead_gen_proposal",
      audienceSummary: "İzmir/Ege KOBİ; CRM/ERP arayan işletmeler (tahmini segment; GAds verisi yok)",
      headline: "KOBİ’niz için özel CRM",
      primaryText:
        "Öneri taslağı — canlı kampanya değil. SynapTech kurumsal yazılım ve CRM çözümleri. Gerçek harcama yok.",
      suggestedDailyBudgetTry: 250,
    },
    {
      platform: "meta_ads",
      campaignName: "SynapTech — Kurumsal web farkındalık (öneri)",
      objective: "awareness_proposal",
      audienceSummary: "Kurumsal web sitesi yenileme ilgilisi (tahmini; Meta verisi yok)",
      headline: "Kurumsal web sitesi yenileyin",
      primaryText:
        "Öneri taslağı — canlı kampanya değil. Yayın/bütçe değişikliği Owner onayı gerektirir.",
      suggestedDailyBudgetTry: 150,
    },
  ] as const;

  const created: AdsProposalResult["created"] = [];
  let skippedDuplicates = 0;

  for (const p of proposals) {
    const hash = dedupe(["ad", p.platform, p.campaignName]);
    const existing = await prisma.adProposal.findUnique({ where: { dedupeHash: hash } });
    if (existing) {
      skippedDuplicates += 1;
      continue;
    }
    const row = await prisma.adProposal.create({
      data: {
        projectSlug: "synaptech",
        platform: p.platform,
        campaignName: p.campaignName,
        objective: p.objective,
        audienceSummary: p.audienceSummary,
        headline: p.headline,
        primaryText: p.primaryText,
        suggestedDailyBudgetTry: p.suggestedDailyBudgetTry,
        status: "draft_proposal",
        liveLaunch: false,
        notes: "Faz 5C: yalnızca öneri. liveLaunch=false. Zincir: " + (input?.chainId ?? "yok"),
        dedupeHash: hash,
        updatedAt: new Date(),
      },
    });
    created.push({ id: row.id, platform: row.platform, campaignName: row.campaignName });
  }

  await writeAudit({
    category: "growth",
    action: "ads.proposals_created",
    actorKind: "agent",
    actorAgent: "ads-manager",
    summary: `Reklam önerileri: ${created.length} (canlı yayın yok).`,
    metadata: {
      created: created.length,
      skippedDuplicates,
      liveLaunch: false,
      spendPerformed: false,
      realAiExecution: false,
      chainId: input?.chainId ?? null,
    },
  });

  return {
    mode: "proposal_only",
    realAiExecution: false,
    liveLaunch: false,
    spendPerformed: false,
    created,
    skippedDuplicates,
  };
}
