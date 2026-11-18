import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EmptyState, LoadErrorNotice, PageHeader, SectionTitle, ViewSkeleton } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { ModeView } from "@/components/mode/mode-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProjectDetailDemo } from "@/components/views/project-detail-demo";
import { formatDateTime } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/server/api-client";
import { loadDocuments } from "@/server/documents";

export default async function ProjectDetailPage({ params }: PageProps<"/projeler/[slug]">) {
  const { slug } = await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Proje detayı">
        <Link href="/projeler" className="text-sm text-primary hover:underline">
          Projelere dön
        </Link>
      </PageHeader>
      <ModeView
        real={
          <Suspense fallback={<ViewSkeleton />}>
            <ProjectReal slug={slug} />
          </Suspense>
        }
        demo={<ProjectDetailDemo slug={slug} />}
      />
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

type ApiTask = {
  id: string;
  title: string;
  status: string;
  projectSlug: string;
  updatedAt?: string;
};

async function ProjectReal({ slug }: { slug: string }) {
  await connection();
  let project: ApiProject | undefined;
  let tasks: ApiTask[] = [];
  try {
    const [projectsRes, tasksRes] = await Promise.all([
      apiFetch<{ projects: ApiProject[] }>("/api/projects"),
      apiFetch<{ tasks: ApiTask[] }>(`/api/tasks?project=${encodeURIComponent(slug)}`),
    ]);
    project = projectsRes.projects.find((item) => item.slug === slug);
    tasks = tasksRes.tasks ?? [];
  } catch (error) {
    const message = error instanceof ApiClientError ? error.message : "API okunamadı.";
    return <LoadErrorNotice path="/api/projects" error={message} />;
  }
  if (!project) notFound();

  const documents = await loadDocuments();
  const related = documents.filter((doc) => doc.frontmatter.project === slug);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{project.name}</h2>
        <Badge variant="outline">{project.status}</Badge>
        <SourceBadge source="api" />
      </div>
      <p className="text-sm text-muted-foreground">{project.description ?? "Açıklama henüz girilmedi."}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle title="Kimlik" sources={["api"]} />
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>Slug: {project.slug}</p>
            <p>Durum: {project.status}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <SectionTitle title="Repository / Cloud" sources={["api"]} />
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>GitHub: {project.githubRepoUrl ?? "Bağlı değil"}</p>
            <p>
              Cloud Agent proje bayrağı:{" "}
              {project.cloudAgentEnabled ? "açık (allow-list + Owner onayı hâlâ zorunlu)" : "kapalı"}
            </p>
            <p className="text-xs">
              Otomatik Cloud erişimi verilmez. Allow-list şu an yalnızca Pilot deposunu içerir.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionTitle title="Raporlar ve belgeler" sources={["repo-file"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {related.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu projeye ait gerçek belge yok.</p>
          ) : (
            related.map((doc) => (
              <div key={doc.path} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.path} · {formatDateTime(doc.modifiedAt)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Görevler" sources={["api"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="Bu projede görev yok"
              description="CEO formu ile yeni görev oluşturabilirsiniz."
              className="py-6"
            />
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
                <p className="font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.status}
                  {task.updatedAt ? ` · ${formatDateTime(task.updatedAt)}` : ""}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
