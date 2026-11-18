"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import { SectionTitle } from "@/components/common/page-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const LABELS: Record<string, string> = {
  githubRepoCreate: "GitHub deposu oluşturma",
  githubPushDraftPr: "Branch push ve Draft PR",
  customerOutreach: "Müşteri iletişimi",
  productionDeploy: "Production deploy",
  financialSpend: "Finansal harcama / reklam",
  permanentLocalAutonomy: "Kalıcı yerel otonomi (Ollama; 24s pencereden ayrı)",
};

export function OwnerGrantsPanel() {
  const [values, setValues] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/control/ops/grants", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json?.error?.message || "Yetkiler okunamadı");
      return;
    }
    setValues(json.values);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    if (!values) return;
    setSaving(true);
    try {
      const res = await fetch("/api/control/ops/grants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "Kayıt başarısız");
      setValues(json.values);
      toast.success("Yetkiler kaydedildi. Ağ çağrısı bu ekrandan yapılmaz.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kayıt başarısız");
    } finally {
      setSaving(false);
    }
  }

  async function startEpoch() {
    const res = await fetch("/api/control/ops/epoch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: `ops-${new Date().toISOString().slice(0, 10)}`, note: "Pilot kuyruk ayrıldı; silinmedi." }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json?.error?.message || "Epoch başlamadı");
      return;
    }
    toast.success(`Dönem: ${json.epoch.id}`);
  }

  if (!values) return <p className="text-sm text-muted-foreground">Yetkiler yükleniyor…</p>;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Dış işlem yetkileri"
        description="Açık olsa bile ajan merge, spam ve ücretli API yapmaz. Push/ileti/deploy ayrıca kimlik ve işlem onayı ister."
        sources={["api"]}
      />
      <Card>
        <CardContent className="space-y-3 p-4">
          {Object.keys(LABELS).map((key) => (
            <label key={key} className="flex items-center justify-between gap-3 text-sm">
              <span>{LABELS[key]}</span>
              <input
                type="checkbox"
                checked={Boolean(values[key])}
                onChange={(e) => setValues({ ...values, [key]: e.target.checked })}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
              Kaydet
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void startEpoch()}>
              Yeni operasyon dönemi (silme yok)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
