"use client";

import { useEffect, useState } from "react";

import { SourceBadge } from "@/components/common/source-badge";

interface CloudRunRow {
  id: string;
  agentId: string;
  taskTitle: string;
  cursorStatus: string | null;
  status: string;
  executionMode: string | null;
  cursorAgentId: string | null;
  agentUrl: string | null;
  errorMessage: string | null;
}

export function AgentsCloudOverlay({ agentId }: { agentId: string }) {
  const [run, setRun] = useState<CloudRunRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/control/cloud/runs", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || cancelled) return;
        const match = (json.runs as CloudRunRow[] | undefined)?.find((r) => r.agentId === agentId);
        setRun(match ?? null);
      } catch {
        /* sessiz */
      }
    }
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [agentId]);

  if (!run) {
    return <p className="text-xs text-muted-foreground">Cloud: bekliyor / kayıt yok</p>;
  }

  const working =
    run.cursorStatus === "CREATING" ||
    run.cursorStatus === "RUNNING" ||
    run.cursorStatus === "WAITING_FOR_BACKGROUND_WORK";

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source="api" label={working ? "Cloud çalışıyor" : "Cloud son run"} />
        <span className="text-muted-foreground">{run.executionMode}</span>
      </div>
      <p className="text-muted-foreground">
        Görev: {run.taskTitle} · {run.cursorStatus ?? run.status}
      </p>
      {run.agentUrl ? (
        <a className="underline" href={run.agentUrl} target="_blank" rel="noreferrer">
          Cursor Cloud run
        </a>
      ) : run.cursorAgentId ? (
        <p className="text-muted-foreground">Agent: {run.cursorAgentId}</p>
      ) : null}
      {run.errorMessage ? <p className="text-destructive">{run.errorMessage}</p> : null}
    </div>
  );
}
