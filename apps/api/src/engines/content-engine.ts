import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getPrisma } from "../db/prisma.js";
import { getEnv } from "../lib/env.js";
import { killSwitchActive } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { getKillSwitch } from "./kill-switch.js";

function dedupe(parts: string[]): string {
  return createHash("sha256").update(parts.join("|").toLowerCase(), "utf8").digest("hex").slice(0, 64);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function loadPublishedIndex(repoRoot: string): { paths: string[]; missing: boolean } {
  const indexPath = path.resolve(repoRoot, "content/published-index.md");
  if (!fs.existsSync(indexPath)) {
    return { paths: [], missing: true };
  }
  const text = fs.readFileSync(indexPath, "utf8");
  const paths = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => (m[0] ?? "").replace(/[)>.,]+$/, ""));
  const slugs = [...text.matchAll(/\/blog\/([a-z0-9-]+)/gi)]
    .map((m) => m[1]?.toLowerCase())
    .filter((s): s is string => Boolean(s));
  return { paths: [...paths, ...slugs], missing: false };
}

function loadDraftSlugs(repoRoot: string): string[] {
  const out: string[] = [];
  for (const locale of ["tr", "en"]) {
    const dir = path.resolve(repoRoot, `content/blog/drafts/${locale}`);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".md")) out.push(f.replace(/\.md$/i, "").toLowerCase());
    }
  }
  return out;
}

export interface ContentDraftResult {
  mode: "template_draft_pipeline";
  realAiExecution: false;
  llmArticleGenerated: false;
  created: Array<{ id: string; locale: string; slug: string; status: string; contentKind: string }>;
  blockedDuplicates: string[];
  awaitingLlm: boolean;
  publishedIndexMissing: boolean;
  providerGaps: string[];
}

/**
 * SEO fırsatlarından TR/EN blog taslakları (şablon).
 * Tamamlanmış AI makalesi değildir. Yayın yok.
 */
export async function createContentDraftsFromSeo(input?: {
  chainId?: string | null;
}): Promise<ContentDraftResult> {
  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: content draft yok.");

  const prisma = getPrisma();
  const repoRoot = path.resolve(process.cwd(), getEnv().SYNAPTECH_REPO_ROOT);
  const published = loadPublishedIndex(repoRoot);
  const fileDrafts = loadDraftSlugs(repoRoot);

  const findings = await prisma.seoFinding.findMany({
    where: {
      projectSlug: "synaptech",
      status: "open",
      OR: [{ category: "meta" }, { findingKind: "recommendation" }],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const created: ContentDraftResult["created"] = [];
  const blockedDuplicates: string[] = [];
  const providerGaps = [
    "Harici ücretli LLM API yok",
    "Cursor Cloud Agent content üretimi kapalı (Faz 5C)",
    "blog.publish Owner onayı olmadan yasak",
  ];

  const topicBase =
    findings[0]?.title ??
    "Kurumsal web sitesi teknik SEO iyileştirme fırsatları";
  const topics = [
    { locale: "tr" as const, title: `${topicBase} — uygulama kontrol listesi` },
    { locale: "en" as const, title: `Technical SEO checklist from measured site findings` },
  ];

  for (const t of topics) {
    const slug = slugify(t.title);
    const existingBySlug = await prisma.contentDraftRecord.findFirst({
      where: { projectSlug: "synaptech", locale: t.locale, slug },
    });
    if (existingBySlug) {
      blockedDuplicates.push(`${t.locale}/${slug}:exists`);
      created.push({
        id: existingBySlug.id,
        locale: existingBySlug.locale,
        slug: existingBySlug.slug,
        status: existingBySlug.status,
        contentKind: existingBySlug.contentKind,
      });
      continue;
    }

    const collision =
      published.paths.some((p) => p.toLowerCase().includes(slug)) ||
      fileDrafts.includes(slug);

    if (collision) {
      blockedDuplicates.push(`${t.locale}/${slug}`);
      const hash = dedupe(["draft", "synaptech", t.locale, slug, "blocked"]);
      const existing = await prisma.contentDraftRecord.findUnique({ where: { dedupeHash: hash } });
      if (!existing) {
        const row = await prisma.contentDraftRecord.create({
          data: {
            projectSlug: "synaptech",
            locale: t.locale,
            title: t.title.slice(0, 200),
            slug,
            metaDescription: "Mükerrer konu — mevcut blog otomasyonu / published-index ile çakışma.".slice(0, 155),
            status: "blocked_duplicate",
            contentKind: "template",
            qualityNotes: "Mevcut blog otomasyonu veya published-index ile çakışma; üretim engellendi.",
            sourcesJson: JSON.stringify(findings.map((f) => f.pageUrl)).slice(0, 4000),
            seoFindingId: findings[0]?.id ?? null,
            dedupeHash: hash,
            updatedAt: new Date(),
          },
        });
        created.push({
          id: row.id,
          locale: row.locale,
          slug: row.slug,
          status: row.status,
          contentKind: row.contentKind,
        });
      }
      continue;
    }

    const hash = dedupe(["draft", "synaptech", t.locale, slug]);
    const existing = await prisma.contentDraftRecord.findUnique({ where: { dedupeHash: hash } });
    if (existing) {
      blockedDuplicates.push(`${t.locale}/${slug}:db`);
      continue;
    }

    const metaDescription = (
      t.locale === "tr"
        ? "Ölçülmüş SEO bulgularından türetilmiş taslak kontrol listesi. Tam AI makalesi değildir; yayınlanmaz."
        : "Template draft from measured SEO findings. Not a finished AI article; not published."
    ).slice(0, 155);

    const bodyTemplate = [
      `# ${t.title}`,
      "",
      "> contentKind=template — gerçek LLM makalesi değil.",
      "> publish_approval=pending — otomatik yayın yok.",
      "",
      "## Kaynaklar (ölçülmüş)",
      ...findings.slice(0, 3).map((f) => `- ${f.title} — ${f.pageUrl}`),
      "",
      "## Taslak bölümler",
      "1. Ölçüm özeti",
      "2. robots/sitemap/meta bulguları",
      "3. Öneri vs ölçüm ayrımı",
      "4. GSC/GA4 eksikliği notu",
      "",
      "## Kalite kontrol",
      `- Meta title ≤ 60: ${t.title.length <= 60 ? "OK" : "UZUN"}`,
      `- Meta description ≤ 155: ${metaDescription.length <= 155 ? "OK" : "UZUN"}`,
      `- Mükerrerlik: published-index ${published.missing ? "EKSİK (risk)" : "kontrol edildi"}`,
      "",
      "## LLM boşluğu",
      "Tam makale için model sağlayıcısı ve Owner yetkisi gerekli (henüz yok).",
    ].join("\n");

    const row = await prisma.contentDraftRecord.create({
      data: {
        projectSlug: "synaptech",
        locale: t.locale,
        title: t.title.slice(0, 200),
        slug,
        metaDescription,
        outlineJson: JSON.stringify(["ölçüm", "teknik bulgular", "öneriler", "eksik veri"]).slice(0, 4000),
        bodyTemplate,
        sourcesJson: JSON.stringify(
          findings.map((f) => ({ id: f.id, url: f.pageUrl, kind: f.findingKind })),
        ).slice(0, 4000),
        seoFindingId: findings[0]?.id ?? null,
        status: "awaiting_llm",
        contentKind: "template",
        qualityNotes:
          "Şablon taslak kaydedildi. Tam AI içeriği için LLM yok → awaiting_llm. Yayın yok.",
        dedupeHash: hash,
        updatedAt: new Date(),
      },
    });

    // Dosya sistemine de şablon yaz (draft klasörü)
    const draftDir = path.resolve(repoRoot, `content/blog/drafts/${t.locale}`);
    fs.mkdirSync(draftDir, { recursive: true });
    const filePath = path.join(draftDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        [
          "---",
          `title: "${t.title.replace(/"/g, "'")}"`,
          `slug: "${slug}"`,
          `locale: "${t.locale}"`,
          "status: draft",
          "seo_review: pending",
          "publish_approval: pending",
          "content_kind: template",
          `date: "${new Date().toISOString().slice(0, 10)}"`,
          "agent: content-manager",
          "project: synaptech",
          "---",
          "",
          bodyTemplate,
          "",
        ].join("\n"),
        "utf8",
      );
    }

    created.push({
      id: row.id,
      locale: row.locale,
      slug: row.slug,
      status: row.status,
      contentKind: row.contentKind,
    });
  }

  await writeAudit({
    category: "growth",
    action: "content.drafts_created",
    actorKind: "agent",
    actorAgent: "content-manager",
    summary: `İçerik taslakları: ${created.length} kayıt (template; LLM makalesi değil).`,
    metadata: {
      created: created.length,
      blockedDuplicates,
      publishedIndexMissing: published.missing,
      llmArticleGenerated: false,
      realAiExecution: false,
      chainId: input?.chainId ?? null,
    },
  });

  return {
    mode: "template_draft_pipeline",
    realAiExecution: false,
    llmArticleGenerated: false,
    created,
    blockedDuplicates,
    awaitingLlm: created.some((c) => c.status === "awaiting_llm"),
    publishedIndexMissing: published.missing,
    providerGaps,
  };
}
