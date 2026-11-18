"use client";

import {
  selectDemo,
  sortByTimeDesc,
  taskHistoryToActivity,
  type ActivityEvent,
} from "@synaptech/shared";
import { Bot, CheckCircle2, ClipboardList, ShieldAlert } from "lucide-react";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { EmptyState, SectionTitle, StatCard } from "@/components/common/page-parts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoDataset } from "@/lib/demo/store";

export function OverviewDemo() {
  const { dataset, ready } = useDemoDataset();
  if (!ready || !dataset) {
    return <EmptyState icon={ClipboardList} title="DEMO verisi yükleniyor…" />;
  }

  const tasks = selectDemo(dataset.tasks, "genel bakış görevleri");
  const approvals = selectDemo(dataset.approvals, "genel bakış onayları");
  const active = tasks.filter((task) => ["in_progress", "testing", "in_review"].includes(task.status) && !task.paused).length;
  const done = tasks.filter((task) => task.status === "done").length;
  const pendingApprovals = approvals.filter((item) => item.status === "pending").length;
  const names = Object.fromEntries(tasks.map((task) => [task.assignee, task.assignee]));
  const activity: ActivityEvent[] = selectDemo(
    sortByTimeDesc([...taskHistoryToActivity(tasks, names), ...dataset.activity]),
    "genel bakış faaliyetleri",
  ).slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="AI çalışanı (örnek)" value={9} source="demo" icon={Bot} />
        <StatCard label="Aktif görev" value={active} source="demo" icon={ClipboardList} />
        <StatCard label="Tamamlanan görev" value={done} source="demo" icon={CheckCircle2} />
        <StatCard label="Bekleyen onay" value={pendingApprovals} source="demo" icon={ShieldAlert} />
      </div>
      <Card>
        <CardHeader>
          <SectionTitle title="DEMO faaliyetler" sources={["demo"]} />
        </CardHeader>
        <CardContent>
          <ActivityTimeline events={activity} emptyTitle="DEMO faaliyet yok" />
        </CardContent>
      </Card>
    </div>
  );
}
