"use client";

import { selectDemo, sortByTimeDesc, taskHistoryToActivity } from "@synaptech/shared";
import { Activity } from "lucide-react";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoDataset } from "@/lib/demo/store";

export function ActivityDemo() {
  const { dataset, ready } = useDemoDataset();
  if (!ready || !dataset) return <EmptyState icon={Activity} title="DEMO verisi yükleniyor…" />;

  const tasks = selectDemo(dataset.tasks, "aktivite görevleri");
  const extras = selectDemo(dataset.activity, "aktivite olayları");
  const events = selectDemo(
    sortByTimeDesc([...taskHistoryToActivity(tasks), ...extras]),
    "aktivite birleşik",
  );

  return (
    <Card>
      <CardHeader>
        <SectionTitle title="DEMO zaman çizelgesi" sources={["demo"]} />
      </CardHeader>
      <CardContent>
        <ActivityTimeline events={events} />
      </CardContent>
    </Card>
  );
}
