"use client";

import { useCallback, useEffect, useState } from "react";

import {
  APPROVAL_TYPE_LABELS,
  EFFECTIVE_APPROVAL_STATUS_LABELS,
  RISK_LABELS,
  type ApprovalRequest,
  type EffectiveApprovalStatus,
} from "@synaptech/shared";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

type ApprovalRow = ApprovalRequest & { effectiveStatus: EffectiveApprovalStatus };

type DecisionItem = {
  id: string;
  kind: "approval_request" | "task_awaiting_approval";
  title: string;
  projectSlug: string | null;
  type: string;
  createdAt: string;
};

async function controlFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api/control/${path}`, { ...init, headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Hata (${res.status})`);
  return json as T;
}

export function ApprovalsReal() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [queue, setQueue] = useState<DecisionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [data, decisions] = await Promise.all([
        controlFetch<{ approvals: ApprovalRow[] }>("approvals"),
        controlFetch<{ items: DecisionItem[] }>("owner/decision-queue").catch(() => ({ items: [] })),
      ]);
      setApprovals(data.approvals);
      setQueue(decisions.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onaylar yüklenemedi");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function decide(id: string, decision: "approved" | "rejected") {
    try {
      const result = await controlFetch<{
        execution?: { executed: boolean; message: string };
      }>(`approvals/${id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      toast.success(
        decision === "approved"
          ? result.execution?.message ?? "Onaylandı — yerel kuyruk güncellendi"
          : "Reddedildi",
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Karar uygulanamadı");
    }
  }

  if (error) {
    return <EmptyState icon={ShieldCheck} title="Onay API'si yok" description={error} />;
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="Owner karar kuyruğu" sources={["api"]} />
      <p className="text-sm text-muted-foreground">
        Blog yayını, reklam, müşteri ileti, merge, deploy ve GitHub yazma bu kuyrukta bekler. Ajan
        otomatik yürütmez.
      </p>
      {queue.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Bekleyen Owner kararı yok"
          description="Onay kaydı ve awaiting_approval görevler tek listede toplanır."
        />
      ) : (
        queue.map((item) => (
          <Card key={`${item.kind}-${item.id}`}>
            <CardContent className="space-y-1 p-4">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">
                {item.kind === "approval_request" ? "Onay kaydı" : "Görev · onay bekliyor"} ·{" "}
                {item.projectSlug ?? "—"} · {item.type} · {formatDateTime(item.createdAt)}
              </p>
            </CardContent>
          </Card>
        ))
      )}
      <SectionTitle title="Gerçek onay talepleri" sources={["api"]} />
      {approvals.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Bekleyen gerçek onay yok"
          description="Onay motoru kayıt tutar; production işlemi Faz 3'te yürütülmez."
        />
      ) : (
        approvals.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.title}</p>
                <SourceBadge source="api" />
              </div>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <p className="text-xs text-muted-foreground">
                {APPROVAL_TYPE_LABELS[item.type]} · {RISK_LABELS[item.risk]} ·{" "}
                {EFFECTIVE_APPROVAL_STATUS_LABELS[item.effectiveStatus]} · {formatDateTime(item.createdAt)}
              </p>
              {item.effectiveStatus === "pending" ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void decide(item.id, "approved")}>
                    Onayla
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(item.id, "rejected")}>
                    Reddet
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
