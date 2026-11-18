"use client";

import { AGENT_STATUS_LABELS, type AgentId } from "@synaptech/shared";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AgentIcon } from "@/components/common/agent-icon";
import { SourceBadge } from "@/components/common/source-badge";
import { AgentStatusBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import type { AgentDirectoryEntry } from "@/lib/types";

type RuntimeSummary = {
  generatedAt: string;
  continuousAutomation?: boolean;
  automation?: {
    continuousAutomation: boolean;
    reason: string;
    triggerSource: string;
    timerActive: boolean;
    modesArmed: boolean;
  };
  schedulerRuntime?: { timerActive: boolean; processRole?: string; lastTickTrigger?: string };
  quota?: {
    nextEligibleAt: string;
    sources: { ceoReal: number; ceoMock: number; agentReal: number; agentMock: number };
    ceo: { ok: boolean; used: number; max: number; reason?: string };
    agents: { ok: boolean; used: number; max: number; reason?: string };
  };
  modes: {
    schedulerAiCeoMode: string;
    localAgentExecutionMode: string;
    controlledAutonomyMode?: string;
    agentRepoToolsMode: string;
    agentSandboxMode: string;
    modelProvider: string;
    localLlmModel: string;
    cloudLiveEnabled: boolean;
    cursorCloudMode: string;
  };
  configDeclaredStatus?: { cursor: string; github: string; source?: string };
  cursor: {
    pastPilotExists: boolean;
    liveEnabled: boolean;
    liveLabel: string;
    credentialConfigured?: boolean;
    ideIsNotProof?: boolean;
  };
  github: {
    appConnection?: string;
    appLabel: string;
    cloudAgentPermission: string;
    projects: Array<{
      slug: string;
      verified: boolean;
      githubRepoUrl: string | null;
      label: string;
      cloudAgentEnabled: boolean;
    }>;
  };
  ceoScheduler: {
    mode: string;
    lastAuditAt: string | null;
    lastSummary: string | null;
    recentCount: number;
  };
  agents: Array<{
    agentId: AgentId;
    currentlyWorking: boolean;
    statusLabel: string;
    channel: string;
    lastRealModel: string | null;
    lastProvider: string;
    taskCounts: {
      planned: number;
      in_progress: number;
      done: number;
      failed: number;
      total: number;
    };
    lastActivityAt: string | null;
    lastDurationMs?: number | null;
    capabilities?: string[];
    queue?: Array<{ id: string; title: string; status: string }>;
    blocks?: Array<{ id: string; title: string; blockedReason: string | null; status: string }>;
    lastTask: {
      id: string;
      title: string;
      status: string;
      executionKind: string | null;
      model: string | null;
      origin: string | null;
      acceptanceMet: boolean | null;
      codeChangeApplied: boolean | null;
      repoReadCount: number;
      realAiExecution?: boolean | null;
      durationMs?: number | null;
      blockedReason?: string | null;
      updatedAt: string;
    } | null;
    mostRecentTask?: {
      id: string;
      title: string;
      status: string;
      executionKind: string | null;
      updatedAt: string;
    } | null;
    lastMessage: {
      id: string;
      kind: string;
      summary: string;
      from: string;
      to: string;
      at: string;
    } | null;
    notes: string[];
  }>;
};

function statusFromRuntime(
  label: string,
): "working" | "idle" | "completed" | "error" | "disabled" | "awaiting_approval" {
  if (label === "working") return "working";
  if (label === "failed") return "error";
  if (label === "disabled") return "disabled";
  if (label === "completed_recent") return "completed";
  return "idle";
}

function statusLabelTr(card: RuntimeSummary["agents"][number]): string {
  if (card.currentlyWorking) return "Çalışıyor · canlı görev";
  if (card.statusLabel === "no_records") return "Beklemede (kayıt yok)";
  if (card.statusLabel === "completed_recent") return "Son tamamlanan (geçmiş)";
  if (card.statusLabel === "failed") return "Hata";
  if (card.statusLabel === "disabled") return "Kapalı";
  if (card.taskCounts.total > 0 || card.lastMessage) return "Boşta · geçmiş kayıt var";
  return AGENT_STATUS_LABELS.idle;
}

export function AgentsRuntimePanel({ directory }: { directory: AgentDirectoryEntry[] }) {
  const [data, setData] = useState<RuntimeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/control/agents/runtime-summary", { cache: "no-store" });
      const json = (await res.json()) as RuntimeSummary & {
        error?: { message?: string };
      };
      if (!res.ok) {
        setData(null);
        setError(json.error?.message || `API hatası (${res.status})`);
        return;
      }
      setData(json);
      setError(null);
    } catch {
      setData(null);
      setError("Control API erişilemiyor — canlı veri sunulmuyor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  const now = new Date();
  const byId = new Map(directory.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
        <SourceBadge source="api" label="Canlı runtime" />
        {data?.generatedAt ? (
          <span className="text-muted-foreground">
            Son API güncelleme: {formatRelative(data.generatedAt, now)} ({data.generatedAt})
          </span>
        ) : (
          <span className="text-muted-foreground">{loading ? "Yükleniyor…" : "Veri yok"}</span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          <RefreshCw className="size-3.5" />
          Yenile
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Bağlantı hatası: {error}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-2 rounded-lg border border-border bg-card/40 p-3 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            Config beyanı: Cursor=
            {data.configDeclaredStatus?.cursor ?? "none"} · GitHub App=
            {data.configDeclaredStatus?.github ?? "not_connected"}
          </p>
          <p>
            Gözlem Cursor: credential=
            {data.cursor.credentialConfigured ? "var" : "yok"} · {data.cursor.liveLabel}
            {data.cursor.ideIsNotProof ? " · IDE≠Cloud API" : ""}
          </p>
          <p>
            Gözlem GitHub: {data.github.appLabel} ({data.github.appConnection ?? "unknown"})
          </p>
          <p>{data.github.cloudAgentPermission}</p>
          <p>
            Scheduler AI CEO: <strong className="text-foreground">{data.modes.schedulerAiCeoMode}</strong>
            {data.ceoScheduler.lastAuditAt
              ? ` · son audit ${formatRelative(data.ceoScheduler.lastAuditAt, now)}`
              : ""}
          </p>
          <p>
            Kontrollü otonomi:{" "}
            <strong className="text-foreground">
              {data.modes.controlledAutonomyMode ?? "off"}
            </strong>
            {" · "}
            continuousAutomation={String(data.automation?.continuousAutomation ?? data.continuousAutomation ?? false)}
            {data.automation ? ` (${data.automation.reason})` : ""}
          </p>
          <p>
            Timer: {data.schedulerRuntime?.timerActive ? "aktif (bu süreç)" : "pasif bu süreçte"}
            {data.schedulerRuntime?.processRole ? ` · ${data.schedulerRuntime.processRole}` : ""}
            {data.quota
              ? ` · kota CEO gerçek ${data.quota.sources.ceoReal}/${data.quota.ceo.max} mock ${data.quota.sources.ceoMock} · ajan gerçek ${data.quota.sources.agentReal}/${data.quota.agents.max}`
              : ""}
          </p>
          <div className="md:col-span-2 flex flex-wrap gap-1.5">
            {data.github.projects.map((p) => (
              <Badge key={p.slug} variant={p.verified ? "default" : "outline"}>
                {p.slug}: {p.verified ? "verified repo" : "bağlı değil"}
              </Badge>
            ))}
          </div>
          <p className="md:col-span-2">
            Kanallar: localAgent={data.modes.localAgentExecutionMode} · repoTools=
            {data.modes.agentRepoToolsMode} · sandbox={data.modes.agentSandboxMode} · provider=
            {data.modes.modelProvider} ({data.modes.localLlmModel})
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {directory.map((agent) => {
          const fm = agent.definition.frontmatter;
          const runtime = data?.agents.find((a) => a.agentId === agent.id);
          const badgeStatus = runtime
            ? statusFromRuntime(runtime.statusLabel)
            : error
              ? "idle"
              : "idle";
          const label = runtime
            ? statusLabelTr(runtime)
            : error
              ? "API yok"
              : loading
                ? "Yükleniyor…"
                : "Beklemede (kayıt yok)";

          return (
            <Card key={agent.id} className="overflow-hidden">
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                <AgentIcon agentId={agent.id} />
                <div className="min-w-0 flex-1 space-y-1">
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{agent.departmentName}</p>
                </div>
                <AgentStatusBadge status={badgeStatus} label={label} />
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{agent.summary}</p>
                <div className="flex flex-wrap gap-1.5">
                  <SourceBadge source="config" />
                  {fm ? (
                    <SourceBadge source="repo-file" label="Tanım dosyası" />
                  ) : (
                    <Badge variant="outline">Tanım eksik</Badge>
                  )}
                  {runtime ? <SourceBadge source="api" label={runtime.channel} /> : null}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Tanımlı Cursor modeli</dt>
                    <dd className="font-medium">{fm?.model ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Son gerçek model</dt>
                    <dd className="font-medium">{runtime?.lastRealModel ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Sağlayıcı</dt>
                    <dd className="font-medium">{runtime?.lastProvider ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Readonly</dt>
                    <dd className="font-medium">{fm?.readonly ? "Evet" : fm ? "Hayır" : "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Görevler (aktif board)</dt>
                    <dd className="font-medium">
                      {runtime
                        ? `toplam ${runtime.taskCounts.total} · planned ${runtime.taskCounts.planned} · in_progress ${runtime.taskCounts.in_progress} · done ${runtime.taskCounts.done} · failed ${runtime.taskCounts.failed}`
                        : "Kayıt yok"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Birincil görev (gerçek LLM öncelikli)</dt>
                    <dd className="font-medium">
                      {runtime?.lastTask
                        ? `${runtime.lastTask.title} · ${runtime.lastTask.status} · ${runtime.lastTask.executionKind ?? "—"}`
                        : "Kayıt yok"}
                    </dd>
                  </div>
                  {runtime?.mostRecentTask &&
                  runtime.lastTask &&
                  runtime.mostRecentTask.id !== runtime.lastTask.id ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">En güncel kayıt (ayrı)</dt>
                      <dd className="font-medium text-muted-foreground">
                        {runtime.mostRecentTask.title} · {runtime.mostRecentTask.status} ·{" "}
                        {runtime.mostRecentTask.executionKind ?? "—"}
                      </dd>
                    </div>
                  ) : null}
                  {runtime?.lastTask?.repoReadCount ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">repo_read kanıtı</dt>
                      <dd className="font-medium">{runtime.lastTask.repoReadCount}</dd>
                    </div>
                  ) : null}
                  {runtime?.lastTask && runtime.lastTask.codeChangeApplied !== null ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">codeChangeApplied</dt>
                      <dd className="font-medium">
                        {runtime.lastTask.codeChangeApplied ? "true" : "false"}
                      </dd>
                    </div>
                  ) : null}
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Son AgentMessage</dt>
                    <dd className="font-medium">
                      {runtime?.lastMessage
                        ? `${runtime.lastMessage.from}→${runtime.lastMessage.to}: ${runtime.lastMessage.summary}`
                        : "Kayıt yok"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Son aktivite</dt>
                    <dd className="font-medium">
                      {runtime?.lastActivityAt
                        ? formatRelative(runtime.lastActivityAt, now)
                        : "Kayıt yok"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Son LLM süresi</dt>
                    <dd className="font-medium">
                      {runtime?.lastDurationMs != null
                        ? `${Math.round(runtime.lastDurationMs)} ms`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Yetenekler</dt>
                    <dd className="font-medium text-[11px]">
                      {runtime?.capabilities?.length
                        ? runtime.capabilities.join(", ")
                        : "—"}
                    </dd>
                  </div>
                  {runtime?.queue?.length ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Kuyruk</dt>
                      <dd className="font-medium">
                        {runtime.queue
                          .slice(0, 3)
                          .map((q) => `${q.title} (${q.status})`)
                          .join(" · ")}
                        {runtime.queue.length > 3 ? ` · +${runtime.queue.length - 3}` : ""}
                      </dd>
                    </div>
                  ) : null}
                  {runtime?.blocks?.length ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Blokaj</dt>
                      <dd className="font-medium text-destructive">
                        {runtime.blocks
                          .slice(0, 3)
                          .map((b) => `${b.title}: ${b.blockedReason ?? b.status}`)
                          .join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {runtime?.notes?.length ? (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {runtime.notes.map((n) => (
                      <li key={n}>· {n}</li>
                    ))}
                  </ul>
                ) : null}
                {agent.definition.error ? (
                  <p className="text-xs text-warning">{agent.definition.error}</p>
                ) : null}
                {!byId.has(agent.id) ? null : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
