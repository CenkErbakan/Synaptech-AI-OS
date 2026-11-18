"use client";

import {
  AD_PLATFORM_LABELS,
  PUBLISH_APPROVAL_LABELS,
  SEO_REVIEW_LABELS,
  selectDemo,
} from "@synaptech/shared";
import { TrendingUp } from "lucide-react";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDemoDataset } from "@/lib/demo/store";

export function GrowthDemo() {
  const { dataset, ready } = useDemoDataset();
  if (!ready || !dataset) return <EmptyState icon={TrendingUp} title="DEMO verisi yükleniyor…" />;

  const growth = dataset.growth;
  const seoTasks = selectDemo(growth.seoTasks, "seo görevleri");
  const keywords = selectDemo(growth.keywordIdeas, "anahtar kelimeler");
  const calendar = selectDemo(growth.calendar, "takvim");
  const drafts = selectDemo(growth.drafts, "taslaklar");
  const campaigns = selectDemo(growth.campaignProposals, "kampanyalar");
  const copies = selectDemo(growth.adCopies, "reklam metinleri");
  const budgets = selectDemo(growth.budgetSuggestions, "bütçe önerileri");

  return (
    <Tabs defaultValue="seo">
      <TabsList>
        <TabsTrigger value="seo">SEO</TabsTrigger>
        <TabsTrigger value="blog">Blog</TabsTrigger>
        <TabsTrigger value="ads">Reklam</TabsTrigger>
      </TabsList>
      <TabsContent value="seo" className="space-y-3">
        <Card>
          <CardHeader>
            <SectionTitle title="DEMO teknik SEO görevleri" sources={["demo"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {seoTasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.page} · etki: {task.impact} · {task.status}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle title="DEMO anahtar kelime fikirleri" sources={["demo"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {keywords.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{item.keyword}</p>
                <p className="text-xs text-muted-foreground">
                  {item.lang} · {item.intent} · {item.note}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="blog" className="space-y-3">
        <Card>
          <CardHeader>
            <SectionTitle title="DEMO içerik takvimi" sources={["demo"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {calendar.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{entry.topic}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.week} · {entry.lang} · {entry.owner} · {entry.status}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle title="DEMO taslaklar" sources={["demo"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <p className="font-medium">{draft.title}</p>
                  <SourceBadge source="demo" />
                  <Badge variant="outline">{draft.lang.toUpperCase()}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {SEO_REVIEW_LABELS[draft.seoReview]} · {PUBLISH_APPROVAL_LABELS[draft.publishApproval]}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="ads" className="space-y-3">
        <p className="text-xs text-muted-foreground">
          DEMO önerilerdir; gerçek harcama / TBM / tıklama metrikleri yoktur.
        </p>
        {[
          ["Kampanya önerileri", campaigns.map((item) => `${AD_PLATFORM_LABELS[item.platform]} · ${item.name} · ${item.status}`)],
          ["Reklam metinleri", copies.map((item) => `${item.headline} · ${item.status}`)],
          ["Bütçe önerileri", budgets.map((item) => `${AD_PLATFORM_LABELS[item.platform]} · ${item.suggestion}`)],
        ].map(([title, rows]) => (
          <Card key={title as string}>
            <CardHeader>
              <SectionTitle title={`DEMO ${title as string}`} sources={["demo"]} />
            </CardHeader>
            <CardContent className="space-y-2">
              {(rows as string[]).map((row) => (
                <p key={row} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                  {row}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}
      </TabsContent>
    </Tabs>
  );
}
