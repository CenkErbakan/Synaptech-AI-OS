import { connection } from "next/server";
import { Suspense } from "react";

import { LoadErrorNotice, PageHeader, SectionTitle, ViewSkeleton } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { ModeView } from "@/components/mode/mode-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CloudStatusPanel } from "@/components/views/cloud-status-panel";
import { UsageDemo } from "@/components/views/usage-panel";
import { loadBudgetPolicy } from "@/server/config";
import { buildSystemSnapshot } from "@/server/snapshot";

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Kullanım ve Maliyet"
        description="Bireysel Cursor hesabında hesap kullanım API'si yoktur. Değerler manuel girilir veya doğrulanamaz."
      />
      <ModeView
        real={
          <Suspense fallback={<ViewSkeleton />}>
            <UsageReal />
          </Suspense>
        }
        demo={<UsageDemo />}
      />
    </div>
  );
}

async function UsageReal() {
  await connection();
  const [budget, snapshot] = await Promise.all([loadBudgetPolicy(), buildSystemSnapshot(new Date())]);
  if (!budget.ok) return <LoadErrorNotice path={budget.path} error={budget.error} />;

  const models = snapshot.audit.events
    .filter((event) => event.subagent?.model)
    .slice(0, 20)
    .map((event) => ({
      at: event.ts,
      model: event.subagent!.model!,
      type: event.subagent!.type,
    }));

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>Programatik kullanım verisi yok</AlertTitle>
        <AlertDescription>
          Admin/Analytics API yalnızca Enterprise ekiplerde. Bu sayfa tahmin üretmez; manuel giriş veya doğrulanamayan alanlar kullanır.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <SectionTitle title="Abonelik" sources={["manual"]} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Plan: <strong>{budget.data.plan.name}</strong> <SourceBadge source="manual" />
          </p>
          <p>
            On-Demand: <SourceBadge source="unverifiable" label="Doğrulanamıyor" /> — beyan:{" "}
            {budget.data.plan.on_demand_usage}. Kontrol:{" "}
            <a className="text-primary underline" href={budget.data.plan.verification_url} target="_blank" rel="noreferrer">
              cursor.com/dashboard/spending
            </a>
          </p>
          <p>Ek ücretli AI API bütçesi: ${budget.data.budget.extra_ai_api_usd_per_month}</p>
          <p>Ücretli servisler: {budget.data.budget.paid_services.length === 0 ? "yok ($0)" : "tanımlı"}</p>
        </CardContent>
      </Card>

      <CloudStatusPanel />

      <UsageDemo showManualForm />

      <Card>
        <CardHeader>
          <SectionTitle title="Görev / alt ajan model kayıtları" sources={["cursor-hook"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz hook model kaydı yok.</p>
          ) : (
            models.map((item) => (
              <div key={`${item.at}-${item.type}-${item.model}`} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{item.model}</p>
                <p className="text-xs text-muted-foreground">
                  {item.type} · {item.at}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
