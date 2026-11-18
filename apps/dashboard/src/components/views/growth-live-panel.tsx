"use client";

import { useCallback, useEffect, useState } from "react";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

async function controlFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api/control/${path}`, { ...init, headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `İstek başarısız (${res.status})`);
  return json as T;
}

export function GrowthLivePanel() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [leads, setLeads] = useState<Array<Record<string, unknown>>>([]);
  const [seo, setSeo] = useState<Array<Record<string, unknown>>>([]);
  const [drafts, setDrafts] = useState<Array<Record<string, unknown>>>([]);
  const [ads, setAds] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [st, l, s, d, a] = await Promise.all([
        controlFetch<Record<string, unknown>>("growth/status"),
        controlFetch<{ leads: Array<Record<string, unknown>> }>("growth/leads"),
        controlFetch<{ findings: Array<Record<string, unknown>> }>("growth/seo-findings"),
        controlFetch<{ drafts: Array<Record<string, unknown>> }>("growth/content-drafts"),
        controlFetch<{ proposals: Array<Record<string, unknown>> }>("growth/ad-proposals"),
      ]);
      setStatus(st);
      setLeads(l.leads);
      setSeo(s.findings);
      setDrafts(d.drafts);
      setAds(a.proposals);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Büyüme verisi alınamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runCycle = async () => {
    try {
      await controlFetch("growth/cycle", { method: "POST", body: "{}" });
      toast.success("Büyüme döngüsü tetiklendi (deterministik)");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Döngü başarısız");
    }
  };

  const counts = (status?.counts ?? {}) as Record<string, number>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <SectionTitle
            title="Büyüme motoru (Faz 5C)"
            description="Gerçek kamu HTTP taraması + deterministik planlama. LLM/Cloud/ileti/yayın/reklam yok."
            sources={["api"]}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="mr-1 size-3.5" />
              Yenile
            </Button>
            <Button type="button" size="sm" onClick={() => void runCycle()}>
              Döngü çalıştır
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <SourceBadge source="api" />
            <span className="rounded-md border px-2 py-0.5">realAiExecution=false</span>
            <span className="rounded-md border px-2 py-0.5">outreach=false</span>
            <span className="rounded-md border px-2 py-0.5">liveAds=false</span>
          </div>
          <p>
            Lead: {counts.leads ?? 0} · SEO: {counts.seoFindings ?? 0} · Taslak: {counts.drafts ?? 0} · Ads öneri:{" "}
            {counts.adProposals ?? 0}
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="crm">
        <TabsList>
          <TabsTrigger value="crm">Müşteri Adayları</TabsTrigger>
          <TabsTrigger value="seo">SEO Fırsatları</TabsTrigger>
          <TabsTrigger value="blog">Blog Taslakları</TabsTrigger>
          <TabsTrigger value="ads">Reklam Önerileri</TabsTrigger>
        </TabsList>

        <TabsContent value="crm" className="mt-3">
          <Card>
            <CardHeader>
              <SectionTitle title="CRM / Lead" description="Kaynak URL’siz adaylar verified olmaz." sources={["api"]} />
            </CardHeader>
            <CardContent>
              {leads.length === 0 ? (
                <EmptyState icon={RefreshCw} title="Lead yok" description="Growth research sonrası burada görünür." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {leads.map((l) => (
                    <li key={String(l.id)} className="border-b border-border/60 pb-2">
                      <p className="font-medium">{String(l.companyName)}</p>
                      <p className="text-muted-foreground">
                        {String(l.segment)} · conf={String(l.confidenceScore)} · verified={String(l.verified)}
                      </p>
                      <p className="text-xs">{String(l.needSignal)}</p>
                      {l.sourceUrl ? (
                        <p className="text-xs text-muted-foreground">kaynak: {String(l.sourceUrl)}</p>
                      ) : (
                        <p className="text-xs text-destructive">kaynak yok — unverified</p>
                      )}
                      {l.crm && typeof l.crm === "object" ? (
                        <p className="text-xs text-muted-foreground">
                          ürün={(l.crm as { productFit?: string }).productFit} · aşama=
                          {(l.crm as { salesStage?: string }).salesStage} · izin=
                          {(l.crm as { outreachConsent?: string }).outreachConsent}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="mt-3">
          <Card>
            <CardHeader>
              <SectionTitle
                title="SEO bulguları"
                description="measured = ölçüm; recommendation = öneri. GSC/GA4 bağlı değil."
                sources={["api"]}
              />
            </CardHeader>
            <CardContent>
              {seo.length === 0 ? (
                <EmptyState icon={RefreshCw} title="SEO bulgusu yok" description="Tarama sonrası listelenir." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {seo.map((f) => (
                    <li key={String(f.id)} className="border-b border-border/60 pb-2">
                      <p className="font-medium">
                        [{String(f.findingKind)}] {String(f.title)}
                      </p>
                      <p className="text-muted-foreground">
                        {String(f.category)} · HTTP {String(f.httpStatus ?? "—")} · {String(f.pageUrl)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="blog" className="mt-3">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Blog taslakları"
                description="contentKind=template — tamamlanmış AI makalesi değil. Yayın yok."
                sources={["api"]}
              />
            </CardHeader>
            <CardContent>
              {drafts.length === 0 ? (
                <EmptyState icon={RefreshCw} title="Taslak yok" description="Content adımı sonrası görünür." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {drafts.map((d) => (
                    <li key={String(d.id)} className="border-b border-border/60 pb-2">
                      <p className="font-medium">
                        [{String(d.locale)}] {String(d.title)}
                      </p>
                      <p className="text-muted-foreground">
                        {String(d.slug)} · {String(d.status)} · {String(d.contentKind)}
                      </p>
                      {d.qualityNotes ? <p className="text-xs">{String(d.qualityNotes)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ads" className="mt-3">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Reklam önerileri"
                description="draft_proposal — canlı yayın/harcama yok."
                sources={["api"]}
              />
            </CardHeader>
            <CardContent>
              {ads.length === 0 ? (
                <EmptyState icon={RefreshCw} title="Öneri yok" description="Ads adımı sonrası görünür." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {ads.map((p) => (
                    <li key={String(p.id)} className="border-b border-border/60 pb-2">
                      <p className="font-medium">
                        {String(p.platform)} — {String(p.campaignName)}
                      </p>
                      <p className="text-muted-foreground">{String(p.headline)}</p>
                      <p className="text-xs">
                        bütçe önerisi: {String(p.suggestedDailyBudgetTry ?? "—")} TRY/gün · liveLaunch=
                        {String(p.liveLaunch)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
