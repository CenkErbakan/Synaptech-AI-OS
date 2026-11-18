import { auditEventToActivity, selectReal, sortByTimeDesc } from "@synaptech/shared";
import { connection } from "next/server";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { PageHeader, SectionTitle, ViewSkeleton } from "@/components/common/page-parts";
import { ModeView } from "@/components/mode/mode-view";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ActivityDemo } from "@/components/views/activity-demo";
import { CloudActivityPanel } from "@/components/views/cloud-activity-panel";
import { buildSystemSnapshot } from "@/server/snapshot";

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Canlı Aktivite"
        description="Hook audit kayıtları ve Cursor Cloud run olayları (API)."
      />
      <ModeView real={<Suspense fallback={<ViewSkeleton />}><ActivityReal /></Suspense>} demo={<ActivityDemo />} />
    </div>
  );
}

async function ActivityReal() {
  await connection();
  const now = new Date();
  const snapshot = await buildSystemSnapshot(now);
  const events = selectReal(
    sortByTimeDesc(snapshot.audit.events.map((event, index) => auditEventToActivity(event, index))),
    "canlı aktivite",
  );

  return (
    <div className="space-y-4">
      <CloudActivityPanel />
      <Card>
        <CardHeader>
          <SectionTitle
            title="Hook zaman çizelgesi"
            description={
              snapshot.guard.hooksInstalled
                ? `${events.length} olay · guard modu: ${snapshot.guard.mode}`
                : "Hook'lar kurulu değil"
            }
            sources={["cursor-hook"]}
          />
        </CardHeader>
        <CardContent>
          <ActivityTimeline
            events={events}
            now={now}
            emptyTitle="Gerçek faaliyet kaydı yok"
            emptyDescription=".synaptech/audit altına guard kayıtları düştükçe burada görünür."
          />
        </CardContent>
      </Card>
    </div>
  );
}
