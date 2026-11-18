"use client";

import { selectDemo } from "@synaptech/shared";
import { FolderKanban } from "lucide-react";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { TaskStatusBadge } from "@/components/common/status-badges";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoDataset } from "@/lib/demo/store";

export function ProjectDetailDemo({ slug }: { slug: string }) {
  const { dataset, ready } = useDemoDataset();
  if (!ready || !dataset) return <EmptyState icon={FolderKanban} title="DEMO verisi yükleniyor…" />;

  const detail = dataset.projectDetails.find((item) => item.slug === slug);
  const tasks = selectDemo(
    dataset.tasks.filter((task) => task.projectSlug === slug),
    `proje ${slug} görevleri`,
  );

  if (!detail) {
    return <EmptyState icon={FolderKanban} title="DEMO proje bulunamadı" description={slug} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{slug}</h2>
        <SourceBadge source="demo" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle title="DEMO hedefler" sources={["demo"]} />
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {detail.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle title="DEMO riskler" sources={["demo"]} />
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {detail.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <SectionTitle title="DEMO görevler" sources={["demo"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-sm">
              <span>{task.title}</span>
              <TaskStatusBadge status={task.status} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
