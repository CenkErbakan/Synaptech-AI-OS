import { createHash } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { getEnv } from "../lib/env.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";
import { killSwitchActive } from "../lib/errors.js";

function dedupe(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 64);
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<{
  ok: boolean;
  status: number;
  text: string;
  error?: string;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "SynapTechAIOS-SEOScan/5C (+local; permitted public crawl)" },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
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

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    "i",
  );
  return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
}

function extractCanonical(html: string): string | null {
  return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
    ?? null;
}

export interface SeoScanResult {
  mode: "public_http_scan";
  realAiExecution: false;
  websiteUrl: string;
  scanRunId: string;
  status: "succeeded" | "failed" | "partial";
  measured: number;
  recommendations: number;
  findings: Array<{ id: string; title: string; findingKind: string; category: string }>;
  createdCount: number;
  reusedCount: number;
  updatedFindingIds: string[];
  errors: string[];
  gscConnected: false;
  ga4Connected: false;
}

/**
 * SynapTech Website teknik SEO taraması — kamu HTTP.
 * Trafik/sıralama uydurulmaz. GSC/GA4 bağlı değil olarak işaretlenir.
 */
export async function runTechnicalSeoScan(input?: {
  chainId?: string | null;
}): Promise<SeoScanResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: SEO tarama yok.");

  const prisma = getPrisma();
  const website = getEnv().SYNAPTECH_WEBSITE_URL.replace(/\/$/, "");
  const run = await prisma.growthScanRun.create({
    data: {
      kind: "seo_technical",
      status: "running",
      chainId: input?.chainId ?? null,
      summary: `SEO tarama başladı: ${website}`,
    },
  });

  const errors: string[] = [];
  const created: SeoScanResult["findings"] = [];
  const reused: SeoScanResult["findings"] = [];
  const updated: Array<{ id: string; title: string; httpStatus: number | null }> = [];
  const evidence: Record<string, unknown> = { website, fetchedAt: new Date().toISOString() };

  const upsertFinding = async (f: {
    pageUrl: string;
    category: string;
    findingKind: "measured" | "recommendation";
    title: string;
    detail: string;
    evidenceRef?: string;
    httpStatus?: number;
    severity?: string;
  }) => {
    const hash = dedupe(["seo", f.category, f.pageUrl, f.title]);
    const existing = await prisma.seoFinding.findUnique({ where: { dedupeHash: hash } });
    if (existing) {
      const row = await prisma.seoFinding.update({
        where: { id: existing.id },
        data: {
          detail: f.detail,
          evidenceRef: f.evidenceRef?.slice(0, 500) ?? existing.evidenceRef,
          httpStatus: f.httpStatus ?? existing.httpStatus,
          severity: f.severity ?? existing.severity,
          scanRunId: run.id,
          updatedAt: new Date(),
        },
      });
      reused.push({
        id: row.id,
        title: row.title,
        findingKind: row.findingKind,
        category: row.category,
      });
      updated.push({ id: row.id, title: row.title, httpStatus: row.httpStatus });
      return;
    }
    const row = await prisma.seoFinding.create({
      data: {
        projectSlug: "synaptech",
        pageUrl: f.pageUrl.slice(0, 500),
        category: f.category,
        findingKind: f.findingKind,
        title: f.title.slice(0, 200),
        detail: f.detail,
        evidenceRef: f.evidenceRef?.slice(0, 500),
        httpStatus: f.httpStatus ?? null,
        severity: f.severity ?? "info",
        status: "open",
        dedupeHash: hash,
        scanRunId: run.id,
        updatedAt: new Date(),
      },
    });
    created.push({
      id: row.id,
      title: row.title,
      findingKind: row.findingKind,
      category: row.category,
    });
  };

  // robots.txt
  const robotsUrl = `${website}/robots.txt`;
  const robots = await fetchText(robotsUrl);
  evidence.robots = { url: robotsUrl, status: robots.status, ok: robots.ok, error: robots.error };
  if (robots.ok) {
    const hasSitemap = /sitemap:\s*\S+/i.test(robots.text);
    await upsertFinding({
      pageUrl: robotsUrl,
      category: "robots",
      findingKind: "measured",
      title: "robots.txt erişilebilir",
      detail: `HTTP ${robots.status}. Sitemap bildirimi: ${hasSitemap ? "var" : "yok"}. Örnek satırlar: ${robots.text.slice(0, 280).replace(/\s+/g, " ")}`,
      evidenceRef: `http:${robots.status}:${robotsUrl}`,
      httpStatus: robots.status,
      severity: "info",
    });
    if (!hasSitemap) {
      await upsertFinding({
        pageUrl: robotsUrl,
        category: "robots",
        findingKind: "recommendation",
        title: "robots.txt içinde Sitemap satırı ekleyin",
        detail: "Ölçüm: Sitemap satırı bulunamadı. Öneri (ölçülmüş bulgu değil): Sitemap URL’si eklenmeli.",
        severity: "medium",
      });
    }
  } else {
    errors.push(`robots_fetch_failed:${robots.error ?? robots.status}`);
    await upsertFinding({
      pageUrl: robotsUrl,
      category: "robots",
      findingKind: "measured",
      title: "robots.txt erişilemedi",
      detail: `HTTP ${robots.status}. Hata: ${robots.error ?? "yok"}`,
      evidenceRef: `http:${robots.status}:${robotsUrl}`,
      httpStatus: robots.status,
      severity: "high",
    });
  }

  // sitemap.xml
  const sitemapUrl = `${website}/sitemap.xml`;
  const sitemap = await fetchText(sitemapUrl);
  evidence.sitemap = { url: sitemapUrl, status: sitemap.status, ok: sitemap.ok, error: sitemap.error };
  let sitemapUrlCount = 0;
  if (sitemap.ok) {
    sitemapUrlCount = (sitemap.text.match(/<loc>/gi) ?? []).length;
    await upsertFinding({
      pageUrl: sitemapUrl,
      category: "sitemap",
      findingKind: "measured",
      title: `sitemap.xml erişilebilir (${sitemapUrlCount} loc)`,
      detail: `HTTP ${sitemap.status}. <loc> sayısı: ${sitemapUrlCount}.`,
      evidenceRef: `http:${sitemap.status}:${sitemapUrl}:loc=${sitemapUrlCount}`,
      httpStatus: sitemap.status,
      severity: "info",
    });
  } else {
    errors.push(`sitemap_fetch_failed:${sitemap.error ?? sitemap.status}`);
    await upsertFinding({
      pageUrl: sitemapUrl,
      category: "sitemap",
      findingKind: "measured",
      title: "sitemap.xml erişilemedi",
      detail: `HTTP ${sitemap.status}. Hata: ${sitemap.error ?? "yok"}`,
      evidenceRef: `http:${sitemap.status}:${sitemapUrl}`,
      httpStatus: sitemap.status,
      severity: "high",
    });
  }

  // Ana sayfa TR
  const homeUrl = `${website}/tr`;
  const home = await fetchText(homeUrl);
  evidence.home = { url: homeUrl, status: home.status, ok: home.ok, error: home.error, bytes: home.text.length };
  if (home.ok) {
    const title = extractTitle(home.text);
    const desc = extractMeta(home.text, "description");
    const canonical = extractCanonical(home.text);
    const ogTitle = extractMeta(home.text, "og:title");
    await upsertFinding({
      pageUrl: homeUrl,
      category: "meta",
      findingKind: "measured",
      title: "Ana sayfa (/tr) meta ölçümü",
      detail: [
        `HTTP ${home.status}`,
        `title=${title ? `"${title.slice(0, 80)}"` : "YOK"}`,
        `meta description=${desc ? `"${desc.slice(0, 100)}"` : "YOK"}`,
        `canonical=${canonical ?? "YOK"}`,
        `og:title=${ogTitle ? "var" : "yok"}`,
      ].join("; "),
      evidenceRef: `http:${home.status}:${homeUrl}`,
      httpStatus: home.status,
      severity: !title || !desc ? "medium" : "info",
    });
    if (!desc) {
      await upsertFinding({
        pageUrl: homeUrl,
        category: "meta",
        findingKind: "recommendation",
        title: "Meta description eksik — eklenmesi önerilir",
        detail: "Ölçüm: description meta yok. Öneri: 155 karakteri aşmayan açıklama ekleyin. Trafik etkisi bilinmiyor (GSC bağlı değil).",
        severity: "medium",
      });
    }
    if (!canonical) {
      await upsertFinding({
        pageUrl: homeUrl,
        category: "canonical",
        findingKind: "recommendation",
        title: "Canonical link eksik olabilir",
        detail: "Ölçüm: canonical bulunamadı. Öneri: self-canonical ekleyin.",
        severity: "low",
      });
    }
  } else {
    errors.push(`home_fetch_failed:${home.error ?? home.status}`);
    await upsertFinding({
      pageUrl: homeUrl,
      category: "meta",
      findingKind: "measured",
      title: "Ana sayfa (/tr) erişilemedi",
      detail: `HTTP ${home.status}. Hata: ${home.error ?? "yok"}`,
      evidenceRef: `http:${home.status}:${homeUrl}`,
      httpStatus: home.status,
      severity: "high",
    });
  }

  // GSC/GA4 — bağlı değil (geleceğe uygun kayıt)
  await upsertFinding({
    pageUrl: website,
    category: "analytics",
    findingKind: "measured",
    title: "Search Console / GA4 bağlı değil",
    detail:
      "Trafik, sıralama ve tıklama verisi yok. Uydurma yapılmadı. Gelecek entegrasyon: readonly GSC/GA4 (config/integrations.yaml).",
    severity: "info",
  });

  const listed = [...created, ...reused];
  const measured = listed.filter((c) => c.findingKind === "measured").length;
  const recommendations = listed.filter((c) => c.findingKind === "recommendation").length;
  const status =
    errors.length === 0 ? "succeeded" : measured > 0 ? "partial" : "failed";

  await prisma.growthScanRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      summary: `SEO tarama ${status}: measured=${measured}, recommendations=${recommendations}, created=${created.length}, reused=${reused.length}, errors=${errors.length}`,
      evidenceJson: JSON.stringify(evidence).slice(0, 8000),
      errorMessage: errors.length ? errors.join("; ").slice(0, 1000) : null,
    },
  });

  await writeAudit({
    category: "growth",
    action: "seo.scan_completed",
    actorKind: "agent",
    actorAgent: "seo-specialist",
    summary: `Teknik SEO tarama: ${status}`,
    metadata: {
      scanRunId: run.id,
      website,
      measured,
      recommendations,
      createdCount: created.length,
      reusedCount: reused.length,
      updatedFindingIds: updated.map((u) => u.id),
      errors,
      realAiExecution: false,
      gscConnected: false,
      ga4Connected: false,
    },
  });

  return {
    mode: "public_http_scan",
    realAiExecution: false,
    websiteUrl: website,
    scanRunId: run.id,
    status,
    measured,
    recommendations,
    findings: listed,
    createdCount: created.length,
    reusedCount: reused.length,
    updatedFindingIds: updated.map((u) => u.id),
    errors,
    gscConnected: false,
    ga4Connected: false,
  };
}
