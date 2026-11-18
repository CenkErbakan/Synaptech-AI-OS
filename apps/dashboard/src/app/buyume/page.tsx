import {
  AD_PLATFORM_LABELS,
  INTEGRATION_STATUS_LABELS,
  PUBLISH_APPROVAL_LABELS,
  SEO_REVIEW_LABELS,
} from "@synaptech/shared";
import { Search } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";

import { EmptyState, LoadErrorNotice, PageHeader, SectionTitle, ViewSkeleton } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { ModeView } from "@/components/mode/mode-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GrowthDemo } from "@/components/views/growth-demo";
import { GrowthLivePanel } from "@/components/views/growth-live-panel";
import { formatDateTime } from "@/lib/format";
import { loadIntegrations } from "@/server/config";
import { loadContentDrafts, loadDocuments } from "@/server/documents";

export default function GrowthPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Büyüme Paneli"
        description="Faz 5C: CRM, SEO, blog taslakları, reklam önerileri. Bağlı olmayan metrikler uydurulmaz."
      />
      <ModeView real={<Suspense fallback={<ViewSkeleton />}><GrowthReal /></Suspense>} demo={<GrowthDemo />} />
    </div>
  );
}

async function GrowthReal() {
  await connection();
  const [integrations, drafts, documents] = await Promise.all([
    loadIntegrations(),
    loadContentDrafts(),
    loadDocuments(),
  ]);

  const growthIntegrations = integrations.ok
    ? integrations.data.integrations.filter((item) => item.category === "buyume")
    : [];
  const seoDocs = documents.filter((doc) => doc.area === "marketing" && doc.path.includes("/seo/"));
  const adDocs = documents.filter((doc) => doc.area === "marketing" && doc.path.includes("/ads/"));
  const calendarDocs = documents.filter((doc) => doc.area === "content" && doc.path.includes("/calendar/"));

  return (
    <div className="space-y-4">
      <GrowthLivePanel />
      {!integrations.ok ? <LoadErrorNotice path={integrations.path} error={integrations.error} /> : null}

      <Card>
        <CardHeader>
          <SectionTitle title="Harici büyüme kaynakları" sources={["config", "not-connected"]} />
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {growthIntegrations.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{item.name}</p>
                <Badge variant="outline">{INTEGRATION_STATUS_LABELS[item.status]}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.purpose}</p>
              {item.planned_access?.length ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Planlanan yetki: {item.planned_access.join("; ")}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Tabs defaultValue="seo">
        <TabsList>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="blog">Blog</TabsTrigger>
          <TabsTrigger value="ads">Reklam</TabsTrigger>
        </TabsList>
        <TabsContent value="seo" className="space-y-3">
          <SectionTitle title="SEO raporları" sources={["repo-file"]} />
          {seoDocs.length === 0 ? (
            <EmptyState icon={Search} title="SEO belgesi yok" description="marketing/seo altına rapor düştükçe burada görünür." />
          ) : (
            seoDocs.map((doc) => (
              <DocRow key={doc.path} title={doc.title} path={doc.path} at={doc.modifiedAt} />
            ))
          )}
        </TabsContent>
        <TabsContent value="blog" className="space-y-3">
          <SectionTitle title="İçerik takvimi" sources={["repo-file"]} />
          {calendarDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Takvim dosyası yok.</p>
          ) : (
            calendarDocs.map((doc) => <DocRow key={doc.path} title={doc.title} path={doc.path} at={doc.modifiedAt} />)
          )}
          <SectionTitle title="Blog taslakları" sources={["repo-file"]} />
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Taslak yok. Yayın yapılmaz; mevcut blog otomasyonuyla mükerrer içerik üretilmez.</p>
          ) : (
            drafts.map((draft) => (
              <div key={draft.path} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{draft.title}</p>
                  <SourceBadge source="repo-file" />
                  <Badge variant="outline">{draft.lang.toUpperCase()}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{draft.path}</p>
                {draft.frontmatter ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {SEO_REVIEW_LABELS[draft.frontmatter.seo_review]} · {PUBLISH_APPROVAL_LABELS[draft.frontmatter.publish_approval]}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-warning">{draft.error}</p>
                )}
              </div>
            ))
          )}
        </TabsContent>
        <TabsContent value="ads" className="space-y-3">
          <SectionTitle title="Reklam önerileri" sources={["repo-file", "not-connected"]} />
          <p className="text-sm text-muted-foreground">
            Google Ads / Meta Ads bağlı değil. Performans metrikleri gösterilmez. {AD_PLATFORM_LABELS.google_ads} ve{" "}
            {AD_PLATFORM_LABELS.meta_ads} için yalnızca dosya tabanlı öneriler listelenir.
          </p>
          {adDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Reklam belgesi yok.</p>
          ) : (
            adDocs.map((doc) => <DocRow key={doc.path} title={doc.title} path={doc.path} at={doc.modifiedAt} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DocRow({ title, path, at }: { title: string; path: string; at: string }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">
        {path} · {formatDateTime(at)}
      </p>
    </div>
  );
}
