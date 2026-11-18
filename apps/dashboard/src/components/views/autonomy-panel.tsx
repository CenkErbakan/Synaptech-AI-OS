"use client";

import { useCallback, useEffect, useState } from "react";

import { Inbox, ListTodo, MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface AutonomyStatus {
  phase: string;
  planner: string;
  deterministicPlannerAvailable?: boolean;
  schedulerAiCeoMode?: string;
  llmIntegrated: boolean;
  localLlmScheduledEnabled?: boolean;
  cloudAutoDispatch: boolean;
  note?: string;
  limits?: { maxPerDay: number; runsToday: number; concurrentLocalLlmCalls: number };
  counts: {
    goals: number;
    opportunities: number;
    messages: number;
    aiCeoParentTasks?: number;
  };
  jobs: Array<{
    jobKey: string;
    enabled: boolean;
    cronExpr: string;
    lastStatus: string | null;
    lastFinishedAt: string | null;
  }>;
  recentRuns: Array<{
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    message: string | null;
    idempotencyKey: string;
  }>;
}

interface OpportunityRow {
  id: string;
  title: string;
  projectSlug: string;
  status: string;
  verified: boolean;
  evidenceRef: string | null;
  suggestedAgentId: string;
  createdAt: string;
}

interface AutonomyTaskRow {
  id: string;
  title: string;
  status: string;
  projectSlug: string;
  assigneeId: string;
  parentTaskId: string | null;
  executionPolicy: string | null;
  executionKind?: string | null;
  origin: string | null;
  model?: string | null;
  dispatchState: string;
  blockedReason?: string | null;
  plannerChannel?: string;
  createdAt: string;
}

interface AgentMessageRow {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  taskId: string | null;
  kind: string;
  summary: string;
  createdAt: string;
}

async function controlFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api/control/${path}`, { ...init, headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `İstek başarısız (${res.status})`);
  return json as T;
}

export function AutonomyPanel() {
  const [status, setStatus] = useState<AutonomyStatus | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [tasks, setTasks] = useState<AutonomyTaskRow[]>([]);
  const [messages, setMessages] = useState<AgentMessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [st, opp, tsk, msg] = await Promise.all([
        controlFetch<AutonomyStatus>("autonomy/status"),
        controlFetch<{ opportunities: OpportunityRow[] }>("autonomy/opportunities"),
        controlFetch<{ tasks: AutonomyTaskRow[] }>("autonomy/tasks"),
        controlFetch<{ messages: AgentMessageRow[] }>("autonomy/messages"),
      ]);
      setStatus(st);
      setOpportunities(opp.opportunities);
      setTasks(tsk.tasks);
      setMessages(msg.messages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Otonomi verisi alınamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runTick = async () => {
    try {
      await controlFetch("autonomy/scheduler/tick", { method: "POST", body: "{}" });
      const mode = status?.schedulerAiCeoMode ?? "off";
      toast.success(
        mode === "off"
          ? "Scheduler tick (deterministik CEO)"
          : mode === "mock"
            ? "Scheduler tick (mock AI CEO — gerçek AI değil)"
            : "Scheduler tick (yerel AI CEO)",
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tick başarısız");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <SectionTitle
            title="Otonom çekirdek (Faz 5E)"
            description="Deterministik CEO ile zamanlanmış AI CEO ayrı kanallardır. Varsayılan: AI kapalı."
            sources={["api"]}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="mr-1 size-3.5" />
              Yenile
            </Button>
            <Button type="button" size="sm" onClick={() => void runTick()}>
              <Sparkles className="mr-1 size-3.5" />
              Tick çalıştır
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {status ? (
            <>
              <div className="flex flex-wrap gap-2">
                <SourceBadge source="api" />
                <span className="rounded-md border px-2 py-0.5">faz={status.phase}</span>
                <span className="rounded-md border px-2 py-0.5">
                  deterministik={String(status.deterministicPlannerAvailable ?? true)}
                </span>
                <span className="rounded-md border px-2 py-0.5">planner={status.planner}</span>
                <span className="rounded-md border px-2 py-0.5">
                  schedulerAi={status.schedulerAiCeoMode ?? "off"}
                </span>
                <span className="rounded-md border px-2 py-0.5">
                  llmIntegrated={String(status.llmIntegrated)}
                </span>
                <span className="rounded-md border px-2 py-0.5">
                  cloudAutoDispatch={String(status.cloudAutoDispatch)}
                </span>
              </div>
              {status.note ? <p className="text-muted-foreground">{status.note}</p> : null}
              {status.limits ? (
                <p className="text-xs text-muted-foreground">
                  AI CEO günlük: {status.limits.runsToday}/{status.limits.maxPerDay} · eşzamanlı LLM:{" "}
                  {status.limits.concurrentLocalLlmCalls}
                </p>
              ) : null}
              <p>
                Hedef: {status.counts.goals} · Fırsat: {status.counts.opportunities} · Mesaj:{" "}
                {status.counts.messages}
                {typeof status.counts.aiCeoParentTasks === "number"
                  ? ` · AI CEO plan: ${status.counts.aiCeoParentTasks}`
                  : ""}
              </p>
              <ul className="space-y-1 text-muted-foreground">
                {status.jobs.map((j) => (
                  <li key={j.jobKey}>
                    {j.jobKey} · {j.cronExpr} · {j.lastStatus ?? "—"} ·{" "}
                    {j.lastFinishedAt ? new Date(j.lastFinishedAt).toLocaleString("tr-TR") : "henüz yok"}
                  </li>
                ))}
              </ul>
              {status.recentRuns.length > 0 ? (
                <div>
                  <p className="mb-1 font-medium">Son scheduler run’ları</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {status.recentRuns.slice(0, 5).map((r) => (
                      <li key={r.id}>
                        {r.status} · {r.idempotencyKey} · {new Date(r.startedAt).toLocaleString("tr-TR")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState icon={Inbox} title="Durum yok" description="API'ye bağlanılamadı veya henüz veri yok." />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle title="Fırsatlar" description="Kanıta dayalı deterministik tarama sonuçları." sources={["api"]} />
          </CardHeader>
          <CardContent>
            {opportunities.length === 0 ? (
              <EmptyState icon={Sparkles} title="Fırsat yok" description="Scheduler tick sonrası fırsatlar burada görünür." />
            ) : (
              <ul className="space-y-2 text-sm">
                {opportunities.slice(0, 12).map((o) => (
                  <li key={o.id} className="border-b border-border/60 pb-2">
                    <p className="font-medium">{o.title}</p>
                    <p className="text-muted-foreground">
                      {o.projectSlug} · {o.status} · verified={String(o.verified)} · → {o.suggestedAgentId}
                    </p>
                    {o.evidenceRef ? <p className="text-xs text-muted-foreground">{o.evidenceRef}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle
              title="Otonom görevler"
              description="Deterministik zincir ile AI CEO plan görevleri ayrı kanal etiketleriyle."
              sources={["api"]}
            />
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <EmptyState icon={ListTodo} title="Otonom görev yok" description="CEO döngüsü görev ürettiğinde listelenir." />
            ) : (
              <ul className="space-y-2 text-sm">
                {tasks.slice(0, 12).map((t) => (
                  <li key={t.id} className="border-b border-border/60 pb-2">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-muted-foreground">
                      {t.projectSlug} · {t.status} · {t.assigneeId}
                      {t.parentTaskId ? " · alt görev" : " · üst görev"} · {t.dispatchState}
                      {t.plannerChannel ? ` · ${t.plannerChannel}` : ""}
                      {t.model ? ` · model=${t.model}` : ""}
                      {t.blockedReason ? ` · ${t.blockedReason}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionTitle title="AgentMessage" description="CEO handoff kayıtları." sources={["api"]} />
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <EmptyState icon={MessageSquare} title="Mesaj yok" description="Handoff oluşunca burada görünür." />
          ) : (
            <ul className="space-y-2 text-sm">
              {messages.slice(0, 15).map((m) => (
                <li key={m.id} className="border-b border-border/60 pb-2">
                  <p>
                    {m.fromAgentId} → {m.toAgentId} · {m.kind}
                  </p>
                  <p className="text-muted-foreground">{m.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
