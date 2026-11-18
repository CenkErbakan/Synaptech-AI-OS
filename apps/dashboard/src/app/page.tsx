import {
  auditEventToActivity,
  selectReal,
  sortByTimeDesc,
  type ActivityEvent,
} from "@synaptech/shared";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  ShieldAlert,
} from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { EmptyState, LoadErrorNotice, PageHeader, SectionTitle, StatCard, ViewSkeleton } from "@/components/common/page-parts";
import { ModeView } from "@/components/mode/mode-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { OverviewDemo } from "@/components/views/overview-demo";
import { CommandCenterPanel } from "@/components/views/command-center-panel";
import { apiAvailable, apiFetch, ApiClientError } from "@/server/api-client";
import { loadAgentDirectory } from "@/server/agents";
import { loadAutomations, loadProjects } from "@/server/config";
import { buildSystemSnapshot } from "@/server/snapshot";

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Şirket komuta merkezi"
        description="CEO, ajanlar, kuyruk, onay kutusu ve model sağlığı. Canlı otonomi ayrı kapıdır; bu ekran tek bakış noktasıdır."
      />
      <ModeView real={<Suspense fallback={<ViewSkeleton />}><OverviewReal /></Suspense>} demo={<OverviewDemo />} />
    </div>
  );
}

async function OverviewReal() {
  await connection();
  const now = new Date();
  const [agents, projects, automations, snapshot, apiUp] = await Promise.all([
    loadAgentDirectory(),
    loadProjects(),
    loadAutomations(),
    buildSystemSnapshot(now),
    apiAvailable(),
  ]);

  let activeTasks: number | "—" = "—";
  let doneTasks: number | "—" = "—";
  let pendingApprovals: number | "—" = "—";
  let taskHint = "Control API bağlı değil";
  let approvalHint = "Control API bağlı değil";
  let taskSource: "api" | "not-connected" = "not-connected";
  let apiProjects: Array<{ slug: string; name: string; status: string; githubRepoUrl: string | null }> | null =
    null;

  if (apiUp) {
    try {
      const [taskRes, approvalRes, projectRes] = await Promise.all([
        apiFetch<{ tasks: Array<{ status: string; paused: boolean }> }>("/api/tasks"),
        apiFetch<{ approvals: Array<{ effectiveStatus: string }> }>("/api/approvals"),
        apiFetch<{
          projects: Array<{ slug: string; name: string; status: string; githubRepoUrl: string | null }>;
        }>("/api/projects"),
      ]);
      activeTasks = taskRes.tasks.filter(
        (task) => ["in_progress", "testing", "in_review"].includes(task.status) && !task.paused,
      ).length;
      doneTasks = taskRes.tasks.filter((task) => task.status === "done").length;
      pendingApprovals = approvalRes.approvals.filter((item) => item.effectiveStatus === "pending").length;
      apiProjects = projectRes.projects;
      taskHint = "MSSQL görev motoru";
      approvalHint = "MSSQL onay motoru";
      taskSource = "api";
    } catch (error) {
      if (error instanceof ApiClientError) {
        taskHint = error.message;
        approvalHint = error.message;
      }
    }
  }

  const agentCount = agents.ok ? agents.data.filter((agent) => agent.enabled).length : 0;
  const projectCount = apiProjects?.length ?? (projects.ok ? projects.data.projects.length : 0);
  const projectSource = apiProjects ? ("api" as const) : ("config" as const);
  const projectRows =
    apiProjects ??
    (projects.ok
      ? projects.data.projects.map((p) => ({
          slug: p.slug,
          name: p.name,
          status: p.status,
          githubRepoUrl: null as string | null,
        }))
      : []);
  const upcoming = automations.ok
    ? automations.data.automations.filter((item) => !item.enabled)
    : [];
  const denies = snapshot.audit.events.filter((event) => event.decision === "deny" || event.decision === "error");
  const activity: ActivityEvent[] = selectReal(
    sortByTimeDesc(snapshot.audit.events.map((event, index) => auditEventToActivity(event, index))),
    "genel bakış faaliyetleri",
  ).slice(0, 12);

  return (
    <div className="space-y-6">
      <CommandCenterPanel />
      {!agents.ok ? <LoadErrorNotice path={agents.path} error={agents.error} /> : null}
      {!projects.ok ? <LoadErrorNotice path={projects.path} error={projects.error} /> : null}
      {!automations.ok ? <LoadErrorNotice path={automations.path} error={automations.error} /> : null}
      {!snapshot.killSwitch.ok ? (
        <LoadErrorNotice path={snapshot.killSwitch.path} error={snapshot.killSwitch.error} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="AI çalışanı" value={agentCount || "—"} source="config" icon={Bot} hint="config/agents.yaml + .cursor/agents" />
        <StatCard label="Aktif görev" value={activeTasks} source={taskSource} icon={ClipboardList} hint={taskHint} />
        <StatCard label="Tamamlanan görev" value={doneTasks} source={taskSource} icon={CheckCircle2} hint={taskHint} />
        <StatCard label="Bekleyen onay" value={pendingApprovals} source={taskSource} icon={ShieldAlert} hint={approvalHint} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <SectionTitle title="Aktif projeler" sources={[projectSource]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {projectRows.length > 0 ? (
              projectRows.map((project) => (
                <div key={project.slug} className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="size-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{project.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        GitHub: {project.githubRepoUrl ?? "Bağlı değil"}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">{project.status}</Badge>
                </div>
              ))
            ) : (
              <EmptyState icon={FolderKanban} title="Proje kaydı okunamadı" />
            )}
            <p className="pt-1 text-xs text-muted-foreground">Toplam: {projectCount}</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <SectionTitle title="Yaklaşan otomasyonlar" sources={["config"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.name}</p>
                  <Badge variant="outline">Etkin değil</Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{item.trigger.schedule_human}</p>
              </div>
            ))}
            {upcoming.length === 0 ? (
              <EmptyState icon={AlertTriangle} title="Otomasyon kaydı yok" description="config/automations.yaml" />
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <SectionTitle title="Hata ve güvenlik uyarıları" sources={["cursor-hook"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {denies.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title="Guard reddi yok"
                description={
                  snapshot.guard.hooksInstalled
                    ? "Son audit dosyalarında deny/error kaydı bulunmadı."
                    : "Hook'lar henüz kurulmadı; gerçek ret kaydı oluşmaz."
                }
              />
            ) : (
              denies.slice(0, 6).map((event, index) => {
                const mapped = auditEventToActivity(event, index);
                return (
                  <div key={mapped.id} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <p className="text-sm font-medium">{mapped.title}</p>
                    {mapped.detail ? <p className="mt-1 text-[11px] text-muted-foreground">{mapped.detail}</p> : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionTitle title="Son faaliyetler" description="Yalnızca Cursor hook audit kayıtları" sources={["cursor-hook"]} />
        </CardHeader>
        <CardContent>
          <ActivityTimeline
            events={activity}
            now={now}
            emptyTitle="Gerçek faaliyet kaydı yok"
            emptyDescription="Ajan oturumu veya guard kararı oluşunca burada görünür."
          />
        </CardContent>
      </Card>
    </div>
  );
}
