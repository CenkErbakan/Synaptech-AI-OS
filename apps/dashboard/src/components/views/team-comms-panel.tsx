"use client";

import { useCallback, useEffect, useState } from "react";

import { MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface ChainRow {
  parentTaskId: string;
  chainId: string | null;
  title: string;
  status: string;
  workflowPhase: string | null;
  projectSlug: string;
  executionKind: string | null;
}

interface StepRow {
  id: string;
  title: string;
  chainStep: string | null;
  assigneeId: string;
  status: string;
  workflowPhase: string | null;
  dependsOnTaskId: string | null;
  acceptanceCriteria: string | null;
  executionResult: string | null;
  blockedReason: string | null;
}

interface MsgRow {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  kind: string;
  summary: string;
  chainId: string | null;
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

export function TeamCommsPanel() {
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [feedAt, setFeedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await controlFetch<{ chains: ChainRow[]; realAiExecution: boolean }>(
        "coordination/chains",
      );
      setChains(list.chains);
      const chainId = selected ?? list.chains[0]?.chainId ?? null;
      if (chainId) {
        setSelected(chainId);
        const snap = await controlFetch<{ steps: StepRow[]; messages: MsgRow[] }>(
          `coordination/chains/${chainId}`,
        );
        setSteps(snap.steps);
        setMessages(snap.messages);
      }
      const feed = await controlFetch<{ serverTime: string }>("coordination/feed");
      setFeedAt(feed.serverTime);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ekip iletişimi yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <SectionTitle
            title="AI Ekip İletişimi"
            description="Gerçek MSSQL zincirleri ve AgentMessage. Deterministik koordinasyon — gerçek AI yürütmesi değil."
            sources={["api"]}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="mr-1 size-3.5" />
            Yenile
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <SourceBadge source="api" />
            <span className="rounded-md border px-2 py-0.5">realAiExecution=false</span>
            <span className="rounded-md border px-2 py-0.5">polling=8s</span>
            {feedAt ? <span className="text-muted-foreground">feed @ {new Date(feedAt).toLocaleString("tr-TR")}</span> : null}
          </div>
          {chains.length === 0 ? (
            <EmptyState icon={MessageSquare} title="Zincir yok" description="Koordinasyon zinciri başlayınca burada görünür." />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {chains.map((c) => (
                <li key={c.parentTaskId}>
                  <button
                    type="button"
                    className={`rounded-md border px-2 py-1 text-left text-xs ${selected === c.chainId ? "border-primary bg-primary/10" : ""}`}
                    onClick={() => setSelected(c.chainId)}
                  >
                    {c.projectSlug}: {c.title.slice(0, 48)} · {c.workflowPhase ?? c.status}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle title="Zincir adımları" description="Durum, bağımlılık, kabul ve sonuç." sources={["api"]} />
          </CardHeader>
          <CardContent>
            {steps.length === 0 ? (
              <EmptyState icon={MessageSquare} title="Adım yok" description="Zincir seçin." />
            ) : (
              <ul className="space-y-3 text-sm">
                {steps.map((s) => (
                  <li key={s.id} className="border-b border-border/60 pb-2">
                    <p className="font-medium">
                      {s.chainStep} · {s.assigneeId} · {s.workflowPhase}/{s.status}
                    </p>
                    <p className="text-muted-foreground">{s.title}</p>
                    {s.dependsOnTaskId ? (
                      <p className="text-xs text-muted-foreground">dependsOn: {s.dependsOnTaskId.slice(0, 8)}…</p>
                    ) : null}
                    {s.blockedReason ? <p className="text-xs text-destructive">{s.blockedReason}</p> : null}
                    {s.acceptanceCriteria ? (
                      <p className="text-xs text-muted-foreground">Kabul: {s.acceptanceCriteria}</p>
                    ) : null}
                    {s.executionResult ? (
                      <p className="text-xs">Sonuç: {s.executionResult.slice(0, 180)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle title="AgentMessage" description="Handoff / result / failure / rework." sources={["api"]} />
          </CardHeader>
          <CardContent>
            {messages.length === 0 ? (
              <EmptyState icon={MessageSquare} title="Mesaj yok" description="Devirler burada listelenir." />
            ) : (
              <ul className="space-y-2 text-sm">
                {messages.map((m) => (
                  <li key={m.id} className="border-b border-border/60 pb-2">
                    <p>
                      {m.fromAgentId} → {m.toAgentId} · <span className="font-medium">{m.kind}</span>
                    </p>
                    <p className="text-muted-foreground">{m.summary}</p>
                    <p className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString("tr-TR")}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
