"use client";

import Link from "next/link";

import { selectDemo } from "@synaptech/shared";
import { FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemoDataset } from "@/lib/demo/store";

const NAMES: Record<string, string> = {
  synaptech: "SynapTech",
  subify: "Subify",
  marivo: "Marivo",
  "synaptech-ai-os": "SynapTech AI OS",
};

export function ProjectsDemo() {
  const { dataset, ready } = useDemoDataset();
  if (!ready || !dataset) return <EmptyState icon={FolderKanban} title="DEMO verisi yükleniyor…" />;

  const tasks = selectDemo(dataset.tasks, "proje listesi");
  const details = dataset.projectDetails;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {details.map((project) => {
        const count = tasks.filter((task) => task.projectSlug === project.slug).length;
        return (
          <Card key={project.slug}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">
                  <Link href={`/projeler/${project.slug}`} className="hover:underline">
                    {NAMES[project.slug] ?? project.slug}
                  </Link>
                </CardTitle>
                <Badge variant="outline">DEMO</Badge>
              </div>
              <SourceBadge source="demo" />
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Hedef: {project.goals.length}</p>
              <p>Risk: {project.risks.length}</p>
              <p>Görev: {count}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
