"use client";

import {
  APPROVAL_TYPE_LABELS,
  effectiveApprovalStatus,
  selectDemo,
  shortVersion,
} from "@synaptech/shared";
import { BadgeCheck } from "lucide-react";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { ApprovalStatusBadge, RiskBadge } from "@/components/common/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { demoDecideApproval, demoSimulateNewVersion } from "@/lib/demo/actions";
import { useDemoDataset } from "@/lib/demo/store";
import { useDemoOps } from "@/lib/demo/use-demo-ops";
import { formatDateTime } from "@/lib/format";

export function ApprovalsDemo() {
  const { dataset, ready } = useDemoDataset();
  const { run, options } = useDemoOps();
  if (!ready || !dataset) return <EmptyState icon={BadgeCheck} title="DEMO verisi yükleniyor…" />;

  const approvals = selectDemo(dataset.approvals, "onay merkezi");

  return (
    <div className="space-y-4">
      <SectionTitle title="DEMO onay talepleri" sources={["demo"]} />
      <div className="grid gap-4 lg:grid-cols-2">
        {approvals.map((request) => {
          const status = effectiveApprovalStatus(request);
          return (
            <Card key={request.id}>
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">{request.title}</CardTitle>
                  <ApprovalStatusBadge status={status} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <SourceBadge source="demo" />
                  <RiskBadge risk={request.risk} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{request.description}</p>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Tür</dt>
                    <dd>{APPROVAL_TYPE_LABELS[request.type]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">İsteyen</dt>
                    <dd>{request.requestedBy}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Proje</dt>
                    <dd>{request.projectSlug}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Tarih</dt>
                    <dd>{formatDateTime(request.createdAt)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Değişiklik özeti</dt>
                    <dd>{request.changeSummary}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Bağlı sürüm</dt>
                    <dd className="font-mono">{shortVersion(request.subject.version)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Güncel sürüm</dt>
                    <dd className="font-mono">{shortVersion(request.currentVersion)}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {request.status === "pending" ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          run((current) => demoDecideApproval(current, request.id, "approved", undefined, options()))
                        }
                      >
                        Onayla
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          run((current) => demoDecideApproval(current, request.id, "rejected", undefined, options()))
                        }
                      >
                        Reddet
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run((current) => demoSimulateNewVersion(current, request.id, options()))}
                  >
                    Yeni sürüm simüle et
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
