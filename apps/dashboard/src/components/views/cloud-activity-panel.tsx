"use client";

import { useCallback, useEffect, useState } from "react";

import { Activity } from "lucide-react";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface CloudRunRow {
  id: string;
  taskTitle: string;
  cursorStatus: string | null;
  status: string;
  executionMode: string | null;
  errorMessage: string | null;
  prUrl: string | null;
  createdAt: string;
  cursorAgentId: string | null;
}

export function CloudActivityPanel() {
  const [runs, setRuns] = useState<CloudRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/control/cloud/runs", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "Cloud runları alınamadı");
      setRuns(json.runs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hata");
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(t);
  }, [reload]);

  if (error) {
    return <EmptyState icon={Activity} title="Cloud aktivite yok" description={error} />;
  }

  return (
    <Card>
      <CardHeader>
        <SectionTitle title="Cursor Cloud olayları" sources={["api"]} />
      </CardHeader>
      <CardContent className="space-y-2">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz Cloud run / API olayı yok.</p>
        ) : (
          runs.slice(0, 30).map((run) => (
            <div key={run.id} className="rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{run.taskTitle}</p>
                <SourceBadge source="api" />
              </div>
              <p className="text-xs text-muted-foreground">
                {run.executionMode ?? "—"} · {run.cursorStatus ?? run.status} · {run.createdAt}
              </p>
              {run.cursorAgentId ? (
                <p className="text-[11px] text-muted-foreground">Agent: {run.cursorAgentId}</p>
              ) : null}
              {run.prUrl ? (
                <a className="text-xs underline" href={run.prUrl} target="_blank" rel="noreferrer">
                  GitHub PR
                </a>
              ) : null}
              {run.errorMessage ? <p className="text-xs text-destructive">{run.errorMessage}</p> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
