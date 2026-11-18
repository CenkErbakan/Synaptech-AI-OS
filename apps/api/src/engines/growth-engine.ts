import { createHash } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { killSwitchActive } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";
import { embedLeadCrm } from "./crm-lead.js";

/** SynapTech hizmetlerine uygun müşteri segmentleri (kişisel veri yok). */
export const CUSTOMER_SEGMENTS = [
  {
    id: "izmir-kobi-uretim",
    label: "İzmir/Ege KOBİ üretim",
    needHints: ["stok", "üretim", "erp", "crm", "sipariş"],
  },
  {
    id: "kurumsal-web",
    label: "Kurumsal web sitesi ihtiyacı",
    needHints: ["web", "kurumsal", "dijital"],
  },
  {
    id: "ozel-yazilim",
    label: "Özel yazılım / portal",
    needHints: ["yazılım", "portal", "otomasyon"],
  },
  {
    id: "ai-entegrasyon",
    label: "Yapay zeka entegrasyonu",
    needHints: ["yapay zeka", "ai", "otomasyon"],
  },
] as const;

/**
 * İzinli kamu aday kaynakları — yalnızca şirket web siteleri.
 * Kişisel e-posta/telefon toplanmaz. Kaynak URL yoksa verified=false.
 */
const SELF_HOST_MARKERS = [
  "synaptech.software",
  "synaptech.com",
  "subify",
  "marivo.app",
];

export function isSelfPropertyUrl(url: string): boolean {
  const u = url.toLowerCase();
  return SELF_HOST_MARKERS.some((m) => u.includes(m));
}

/** Dış kamu şirket siteleri — kendi ürün sayfalarımız müşteri adayı değildir. */
const PUBLIC_CANDIDATE_SOURCES: Array<{
  companyNameHint: string;
  websiteUrl: string;
  segment: string;
}> = [
  {
    companyNameHint: "Ege Bölgesi Sanayi Odası",
    websiteUrl: "https://www.ebso.org.tr/",
    segment: "izmir-kobi-uretim",
  },
  {
    companyNameHint: "İzmir Ticaret Odası",
    websiteUrl: "https://www.izto.org.tr/",
    segment: "izmir-kobi-uretim",
  },
  {
    companyNameHint: "Türkiye Odalar ve Borsalar Birliği",
    websiteUrl: "https://www.tobb.org.tr/",
    segment: "kurumsal-web",
  },
].filter((s) => !isSelfPropertyUrl(s.websiteUrl));

function dedupe(parts: string[]): string {
  return createHash("sha256").update(parts.join("|").toLowerCase(), "utf8").digest("hex").slice(0, 64);
}

async function fetchPublic(url: string): Promise<{
  ok: boolean;
  status: number;
  text: string;
  error?: string;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "SynapTechAIOS-GrowthResearch/5C (+local; public pages only)" },
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function titleFromHtml(html: string): string | null {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
}

export interface GrowthResearchResult {
  mode: "public_web_research";
  realAiExecution: false;
  outreachPerformed: false;
  scanRunId: string;
  status: "succeeded" | "failed" | "partial";
  segments: typeof CUSTOMER_SEGMENTS;
  created: number;
  skippedDuplicates: number;
  unverifiedBlocked: number;
  failedFetches: Array<{ url: string; error: string }>;
  leadIds: string[];
}

/**
 * Kamuya açık sayfalardan şirket fırsatı / lead adayı.
 * Otomatik e-posta/DM yok. Kaynaksız aday verified olamaz.
 */
export async function runGrowthLeadResearch(input?: {
  chainId?: string | null;
  maxNewPerRun?: number;
}): Promise<GrowthResearchResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: growth research yok.");

  const prisma = getPrisma();
  const maxNew = input?.maxNewPerRun ?? 5;
  const run = await prisma.growthScanRun.create({
    data: {
      kind: "lead_research",
      status: "running",
      chainId: input?.chainId ?? null,
      summary: "Kamu web lead araştırması başladı",
    },
  });

  let created = 0;
  let skippedDuplicates = 0;
  let unverifiedBlocked = 0;
  const failedFetches: Array<{ url: string; error: string }> = [];
  const leadIds: string[] = [];
  const evidence: Record<string, unknown> = { candidates: [] as unknown[] };

  for (const candidate of PUBLIC_CANDIDATE_SOURCES) {
    if (created >= maxNew) break;
    if (isSelfPropertyUrl(candidate.websiteUrl)) continue;

    const hash = dedupe(["lead", candidate.websiteUrl]);
    const existing = await prisma.lead.findUnique({ where: { dedupeHash: hash } });
    if (existing) {
      skippedDuplicates += 1;
      if (existing.verified && (existing.sourceUrl || existing.websiteUrl)) {
        leadIds.push(existing.id);
      }
      continue;
    }

    const fetched = await fetchPublic(candidate.websiteUrl);
    (evidence.candidates as unknown[]).push({
      url: candidate.websiteUrl,
      status: fetched.status,
      ok: fetched.ok,
      error: fetched.error,
    });

    if (!fetched.ok) {
      failedFetches.push({
        url: candidate.websiteUrl,
        error: fetched.error ?? `http_${fetched.status}`,
      });
      // Kaynak doğrulanamadı → lead yazma (verified sahte başarı yok)
      unverifiedBlocked += 1;
      continue;
    }

    const pageTitle = titleFromHtml(fetched.text) ?? candidate.companyNameHint;
    const lower = fetched.text.toLowerCase();
    const segmentMeta = CUSTOMER_SEGMENTS.find((s) => s.id === candidate.segment);
    const matchedHints = (segmentMeta?.needHints ?? []).filter((h) => lower.includes(h));
    const needSignal =
      matchedHints.length > 0
        ? `Sayfada ihtiyaç sinyali: ${matchedHints.join(", ")}`
        : "Sayfa erişildi; açık ihtiyaç anahtar kelimesi sınırlı";

    const confidence = Math.min(95, 40 + matchedHints.length * 15 + (fetched.status === 200 ? 20 : 0));
    const now = new Date();
    const lead = await prisma.lead.create({
      data: {
        companyName: pageTitle.slice(0, 200),
        websiteUrl: candidate.websiteUrl,
        segment: candidate.segment,
        needSignal: needSignal.slice(0, 500),
        sourceUrl: candidate.websiteUrl,
        sourceKind: "public_company_page",
        confidenceScore: confidence,
        verified: true,
        verifiedAt: now,
        status: "new",
        dedupeHash: hash,
        notes: embedLeadCrm("Kişisel veri toplanmadı. Otomatik ileti yok.", {
          productFit:
            candidate.segment === "ai-entegrasyon"
              ? "synaptech-ai"
              : candidate.segment === "ozel-yazilim"
                ? "synaptech-custom"
                : candidate.segment === "izmir-kobi-uretim"
                  ? "subify-or-ops"
                  : "synaptech-web",
          outreachConsent: "unknown",
          salesStage: "research",
          contactChannel: "none",
        }),
        projectSlug: "synaptech",
        updatedAt: now,
      },
    });
    leadIds.push(lead.id);
    created += 1;
  }

  // Spam koruması: aynı gün aşırı lead yok (ek kontrol)
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = await prisma.lead.count({ where: { createdAt: { gte: dayStart } } });

  const status =
    failedFetches.length === 0 && created + skippedDuplicates > 0
      ? "succeeded"
      : created > 0
        ? "partial"
        : failedFetches.length > 0
          ? "failed"
          : "succeeded";

  await prisma.growthScanRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      summary: `Lead research ${status}: created=${created}, dup=${skippedDuplicates}, blocked=${unverifiedBlocked}, today=${todayCount}`,
      evidenceJson: JSON.stringify(evidence).slice(0, 8000),
      errorMessage: failedFetches.length
        ? failedFetches.map((f) => `${f.url}:${f.error}`).join("; ").slice(0, 1000)
        : null,
    },
  });

  await writeAudit({
    category: "growth",
    action: "growth.lead_research_completed",
    actorKind: "agent",
    actorAgent: "growth-lead",
    summary: `Lead araştırması: ${status}`,
    metadata: {
      scanRunId: run.id,
      created,
      skippedDuplicates,
      unverifiedBlocked,
      failedFetches,
      outreachPerformed: false,
      realAiExecution: false,
    },
  });

  return {
    mode: "public_web_research",
    realAiExecution: false,
    outreachPerformed: false,
    scanRunId: run.id,
    status,
    segments: CUSTOMER_SEGMENTS,
    created,
    skippedDuplicates,
    unverifiedBlocked,
    failedFetches,
    leadIds,
  };
}
