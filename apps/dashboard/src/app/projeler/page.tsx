import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { EmptyState, LoadErrorNotice, PageHeader, ViewSkeleton } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { ModeView } from "@/components/mode/mode-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectsDemo } from "@/components/views/projects-demo";
import { apiFetch, ApiClientError } from "@/server/api-client";
import { FolderKanban } from "lucide-react";

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Projeler"
        description="SynapTech (kurumsal site), Subify, Marivo ve SynapTech AI OS. Gerçek liste MSSQL/API’den gelir."
      />
      <ModeView real={<Suspense fallback={<ViewSkeleton />}><ProjectsReal /></Suspense>} demo={<ProjectsDemo />} />
    </div>
  );
}

type ApiProject = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  githubRepoUrl: string | null;
  cloudAgentEnabled: boolean;
};

async function ProjectsReal() {
  await connection();
  let projects: ApiProject[] = [];
  try {
    const data = await apiFetch<{ projects: ApiProject[] }>("/api/projects");
    projects = data.projects;
  } catch (error) {
    const message = error instanceof ApiClientError ? error.message : "API projeleri okunamadı.";
    return <LoadErrorNotice path="/api/projects" error={message} />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <Card key={project.slug}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">
                <Link href={`/projeler/${project.slug}`} className="hover:underline">
                  {project.name}
                </Link>
              </CardTitle>
              <Badge variant="outline">{project.status}</Badge>
            </div>
            <SourceBadge source="api" />
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{project.description ?? "Açıklama henüz girilmedi."}</p>
            <p>Slug: {project.slug}</p>
            <p>GitHub: {project.githubRepoUrl ?? "Bağlı değil"}</p>
            <p>
              Cloud Agent: {project.cloudAgentEnabled ? "proje bayrağı açık (yine de allow-list + onay gerekir)" : "kapalı"}
            </p>
          </CardContent>
        </Card>
      ))}
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Proje kaydı yok" />
      ) : null}
    </div>
  );
}
