"use client";

import { useCallback, useEffect, useState } from "react";

import { Building2, Cpu, Inbox, Shield } from "lucide-react";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

type CommandCenter = {
  generatedAt: string;
  operationEpoch: { id: string; startedAt: string } | null;
  epochCounts: { epochOpen: number; legacyOpen: number };
  company: {
    killSwitch: boolean;
    continuousAutomation: boolean;
    automationReason: string;
    timerActive: boolean;
    workerId: string | null;
    deferredLlmJobs: number;
    cloudFallback: boolean;
  };
  llm: { dailyCapMode: string; policyNote: string; concurrentMax: number; windowActive: boolean };
  grants: { values: Record<string, boolean>; githubWrite: { reason: string; allowed: boolean } };
  ownerInbox: { pendingCount: number; items: Array<{ id: string; title: string; kind: string; createdAt: string }> };
  ceo: { lastDecisions: Array<{ at: string; summary: string; realAi: boolean }> };
  crm: {
    recentLeads: Array<{
      id: string;
      companyName: string;
      sourceUrl: string | null;
      verified: boolean;
      productFit: string;
      outreachConsent: string;
      salesStage: string;
    }>;
  };
  modes: Record<string, string>;
};

async function loadCenter(): Promise<CommandCenter | { error: string }> {
  const res = await fetch("/api/control/ops/command-center", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) return { error: json?.error?.message || `Hata ${res.status}` };
  return json as CommandCenter;
}

export function CommandCenterPanel() {
  const [data, setData] = useState<CommandCenter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await loadCenter();
    if ("error" in next) {
      setError(next.error);
      setData(null);
      return;
    }
    setError(null);
    setData(next);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) {
    return (
      <EmptyState
        icon={Cpu}
        title="Komuta merkezi API'si yok"
        description={`${error} Çalışan API sürecini yeni kodla yeniden başlatın (modlar off kalsın).`}
      />
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Komuta merkezi yükleniyor…</p>;
  }

  const grantOn = Object.entries(data.grants.values).filter(([, v]) => v).map(([k]) => k);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Şirket komuta merkezi"
        description="Canlı otonomi kapalıysa timer ve kuyruk görünür; Cloud’a düşülmez."
        sources={["api"]}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Otonomi</p>
            <p className="font-medium">{data.company.continuousAutomation ? "Timer + kapılar" : "Kapalı"}</p>
            <p className="text-[11px] text-muted-foreground">{data.company.automationReason}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Worker</p>
            <p className="font-medium">{data.company.timerActive ? "Timer aktif" : "Timer yok"}</p>
            <p className="text-[11px] text-muted-foreground">{data.company.workerId ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">LLM politikası</p>
            <p className="font-medium">{data.llm.dailyCapMode}</p>
            <p className="text-[11px] text-muted-foreground">eşzamanlı {data.llm.concurrentMax} · kuyruk {data.company.deferredLlmJobs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Dönem</p>
            <p className="font-medium">{data.operationEpoch?.id ?? "epoch yok"}</p>
            <p className="text-[11px] text-muted-foreground">
              açık {data.epochCounts.epochOpen} · eski {data.epochCounts.legacyOpen}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle title="CEO son kayıtları" sources={["api"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {data.ceo.lastDecisions.length === 0 ? (
              <EmptyState icon={Building2} title="CEO döngüsü yok" description="Local kapı kapalı veya henüz tick yok." />
            ) : (
              data.ceo.lastDecisions.map((d) => (
                <div key={d.at} className="rounded-lg border border-border/70 px-3 py-2">
                  <p className="text-sm">{d.summary}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(d.at)} · {d.realAi ? "gerçek model" : "mock/skip"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle title="Onay kutusu" sources={["api"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">Bekleyen: {data.ownerInbox.pendingCount}</p>
            {data.ownerInbox.items.slice(0, 5).map((item) => (
              <p key={item.id} className="text-xs text-muted-foreground">
                {item.title}
              </p>
            ))}
            {data.ownerInbox.pendingCount === 0 ? (
              <EmptyState icon={Inbox} title="Boş kutu" description="Dış işlemler grant + onay ister." />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionTitle title="Yetki kapıları (dış işlem)" sources={["api"]} />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <SourceBadge source="api" />
          {grantOn.length === 0 ? (
            <Badge variant="outline">Tümü kapalı — GitHub/ileti/deploy/harcama yok</Badge>
          ) : (
            grantOn.map((k) => (
              <Badge key={k} variant="outline">
                {k}
              </Badge>
            ))
          )}
          <p className="w-full text-[11px] text-muted-foreground">
            GitHub prepare: {data.grants.githubWrite.reason}. Ayar: /yetkiler
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Müşteri adayları" sources={["api"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {data.crm.recentLeads.length === 0 ? (
            <EmptyState icon={Shield} title="Lead yok" description="Growth taraması veya CEO araştırması sonrası dolar." />
          ) : (
            data.crm.recentLeads.map((l) => (
              <div key={l.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{l.companyName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {l.productFit} · {l.salesStage} · izin={l.outreachConsent} · verified={String(l.verified)}
                </p>
                {l.sourceUrl ? <p className="text-[11px]">{l.sourceUrl}</p> : <p className="text-[11px] text-destructive">kaynak yok</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
