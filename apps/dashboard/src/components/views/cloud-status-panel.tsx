"use client";

import { useCallback, useEffect, useState } from "react";

import { Cloud, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CloudStatus {
  connection: string;
  liveEnabled: boolean;
  keyConfigured: boolean;
  mode: string;
  maxConcurrentRuns: number;
  autoRetry: boolean;
  onDemandStatus: string;
  remainingUsageKnown: boolean;
  remainingUsageNote: string;
  allowedRepositories: string[];
  message: string;
  activeRuns?: number;
  apiKeyPresent?: boolean;
}

interface CloudRunRow {
  id: string;
  taskId: string;
  taskTitle: string;
  projectSlug: string;
  agentId: string;
  status: string;
  cursorAgentId: string | null;
  cursorRunId: string | null;
  cursorStatus: string | null;
  githubRepository: string | null;
  branch: string | null;
  prUrl: string | null;
  agentUrl: string | null;
  executionMode: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  totalTokens: number | null;
  cancelVerified: boolean;
  startedAt: string | null;
  finishedAt: string | null;
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

export function CloudStatusPanel() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [runs, setRuns] = useState<CloudRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [st, rn] = await Promise.all([
        controlFetch<{ cloud: CloudStatus }>("cloud/status"),
        controlFetch<{ runs: CloudRunRow[] }>("cloud/runs"),
      ]);
      setStatus(st.cloud);
      setRuns(rn.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cloud durumu alınamadı.");
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(t);
  }, [reload]);

  async function executeRun() {
    setPending(true);
    try {
      const result = await controlFetch<{ ok: boolean; message: string; mode?: string }>("cloud/runs/execute", {
        method: "POST",
        body: JSON.stringify({ taskId, approvalId, repositoryUrl }),
      });
      toast.success(result.message);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execute başarısız");
    } finally {
      setPending(false);
    }
  }

  if (error && !status) {
    return <EmptyState icon={Cloud} title="Cloud API bağlantısı yok" description={error} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <SectionTitle title="Cursor Cloud bağlantısı" sources={["api"]} />
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            <RefreshCw className="size-4" />
            Yenile
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Bağlantı</p>
            <p className="font-medium">{status?.connection ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Mod</p>
            <p className="font-medium">{status?.mode ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">API anahtarı</p>
            <p className="font-medium">{status?.apiKeyPresent || status?.keyConfigured ? "Yapılandırıldı" : "Yok"}</p>
            <p className="text-[11px] text-muted-foreground">Değer gösterilmez / frontend&apos;e gönderilmez.</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Live çalıştırma</p>
            <p className="font-medium">{status?.liveEnabled ? "Açık" : "Kapalı (Faz 4A varsayılan)"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">On-Demand</p>
            <p className="font-medium">{status?.onDemandStatus ?? "Doğrulanamıyor"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Aktif run</p>
            <p className="font-medium">{status?.activeRuns ?? 0} / {status?.maxConcurrentRuns ?? 1}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground">Kalan kullanım</p>
            <p className="font-medium">
              {status?.remainingUsageKnown ? "Biliniyor" : "Programatik olarak bilinmiyor"}
            </p>
            <p className="text-[11px] text-muted-foreground">{status?.remainingUsageNote}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground">Durum notu</p>
            <p>{status?.message}</p>
          </div>
          <div className="md:col-span-2">
            <SourceBadge source="api" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Onaylı Cloud run başlat (mock / pilot)" sources={["api"]} />
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Task ID</Label>
            <Input value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="space-y-1">
            <Label>Approval ID</Label>
            <Input value={approvalId} onChange={(e) => setApprovalId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>İzinli test repository URL</Label>
            <Input
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              placeholder="https://github.com/org/isolated-test-repo"
            />
          </div>
          <Button
            className="md:col-span-2"
            disabled={pending || !taskId || !approvalId || !repositoryUrl}
            onClick={() => void executeRun()}
          >
            {pending ? "Başlatılıyor…" : "Owner execute (live kapalıysa mock)"}
          </Button>
          <p className="text-[11px] text-muted-foreground md:col-span-2">
            Gerçek ücretli Cloud Agent yalnızca CLOUD_AGENT_LIVE_ENABLED=true ve Faz 4B Owner onayı ile.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Cloud run kayıtları" sources={["api"]} />
        </CardHeader>
        <CardContent className="space-y-3">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz Cloud run kaydı yok.</p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="rounded-md border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{run.taskTitle}</p>
                  <SourceBadge source="api" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {run.projectSlug} · {run.agentId} · {run.executionMode ?? "—"} · {run.cursorStatus ?? run.status}
                </p>
                {run.cursorAgentId ? (
                  <p className="text-[11px] text-muted-foreground">
                    Agent: {run.cursorAgentId}
                    {run.agentUrl ? (
                      <>
                        {" · "}
                        <a className="underline" href={run.agentUrl} target="_blank" rel="noreferrer">
                          Cursor
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {run.prUrl ? (
                  <p className="text-[11px]">
                    PR:{" "}
                    <a className="underline" href={run.prUrl} target="_blank" rel="noreferrer">
                      {run.prUrl}
                    </a>
                  </p>
                ) : null}
                {run.errorMessage ? <p className="text-xs text-destructive">{run.errorMessage}</p> : null}
                {run.resultSummary ? <p className="text-xs text-muted-foreground">{run.resultSummary}</p> : null}
                {run.totalTokens != null ? (
                  <p className="text-[11px] text-muted-foreground">Token (run): {run.totalTokens}</p>
                ) : null}
                {!run.cancelVerified && run.status === "cancel_unverified" ? (
                  <p className="text-xs text-amber-200">İptal API&apos;den doğrulanamadı — dikkat.</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
