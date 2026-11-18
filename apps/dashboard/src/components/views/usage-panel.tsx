"use client";

import { useState } from "react";

import { evaluateUsageAlerts } from "@synaptech/shared";
import { Gauge } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useManualUsage, useManualUsageStore } from "@/lib/manual-usage-store";

export function UsageDemo({ showManualForm = true }: { showManualForm?: boolean }) {
  const { entries, hydrated } = useManualUsage();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cursorModelsPercent, setCursorModelsPercent] = useState("40");
  const [otherModelsPercent, setOtherModelsPercent] = useState("");
  const [note, setNote] = useState("");

  if (!hydrated) return <EmptyState icon={Gauge} title="Manuel kullanım yükleniyor…" />;

  const alerts = evaluateUsageAlerts(entries, { warning: 70, critical: 90 });

  return (
    <div className="space-y-4">
      {showManualForm ? (
        <Card>
          <CardHeader>
            <SectionTitle title="Manuel havuz girişi" sources={["manual"]} />
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tarih</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cursor Models %</Label>
              <Input value={cursorModelsPercent} onChange={(event) => setCursorModelsPercent(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Other Models %</Label>
              <Input
                value={otherModelsPercent}
                placeholder="Boş bırakılabilir"
                onChange={(event) => setOtherModelsPercent(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Not</Label>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            <Button
              className="md:col-span-2"
              onClick={() => {
                useManualUsageStore.getState().add({
                  id: `${Date.now()}`,
                  source: "manual",
                  date,
                  cursorModelsPercent: cursorModelsPercent === "" ? null : Number(cursorModelsPercent),
                  otherModelsPercent: otherModelsPercent === "" ? null : Number(otherModelsPercent),
                  note,
                  createdAt: new Date().toISOString(),
                });
                toast.success("Manuel kullanım kaydı eklendi.");
              }}
            >
              Kaydet
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {alerts.length > 0 ? (
        <Card>
          <CardHeader>
            <SectionTitle title="Harcama uyarıları" sources={["manual"]} />
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((alert) => (
              <p key={`${alert.entryId}-${alert.pool}`} className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                {alert.message}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <SectionTitle title="Kayıtlı manuel girişler" sources={["manual"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz manuel giriş yok.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
                <div>
                  <div className="mb-1 flex gap-2">
                    <SourceBadge source="manual" />
                    <span>{entry.date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cursor Models: {entry.cursorModelsPercent ?? "—"}% · Other Models: {entry.otherModelsPercent ?? "—"}%
                  </p>
                  {entry.note ? <p className="mt-1 text-xs">{entry.note}</p> : null}
                </div>
                <Button size="xs" variant="outline" onClick={() => useManualUsageStore.getState().remove(entry.id)}>
                  Sil
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
