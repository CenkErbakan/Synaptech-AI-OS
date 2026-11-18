"use client";

import { cn } from "cn";
import { Power, PowerOff, RefreshCw } from "lucide-react";

import { useSnapshot } from "@/components/providers/snapshot-provider";
import { useViewMode, type ViewMode } from "@/components/providers/view-mode-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";

export function ViewModeToggle() {
  const { mode, setMode } = useViewMode();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={mode ?? ""}
      onValueChange={(value) => {
        if (value === "real" || value === "demo") setMode(value as ViewMode);
      }}
      aria-label="Görünüm modu"
    >
      <ToggleGroupItem value="real" aria-label="Gerçek veriler" className="px-3 data-[state=on]:bg-success/15 data-[state=on]:text-success">
        Gerçek
      </ToggleGroupItem>
      <ToggleGroupItem value="demo" aria-label="DEMO verileri" className="px-3 data-[state=on]:bg-demo/20 data-[state=on]:text-demo">
        DEMO
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function KillSwitchIndicator() {
  const { snapshot, error } = useSnapshot();

  let label = "Kill switch okunuyor…";
  let tone = "border-border text-muted-foreground";
  let enabled = false;

  if (error) {
    label = "Kill switch doğrulanamıyor";
    tone = "border-warning/40 text-warning";
  } else if (snapshot) {
    if (snapshot.killSwitch.ok) {
      enabled = snapshot.killSwitch.data.enabled;
      const conflict = snapshot.killSwitch.data.conflict === true;
      label = enabled
        ? conflict
          ? "Kill switch: AÇIK (fail-safe)"
          : "Kill switch: AÇIK"
        : "Kill switch: kapalı";
      tone = enabled ? "border-destructive/60 bg-destructive/15 text-destructive" : "border-success/40 text-success";
    } else {
      label = "Kill switch dosyası okunamadı";
      tone = "border-warning/40 text-warning";
    }
  }

  const Icon = enabled ? PowerOff : Power;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("h-7 gap-1.5 px-2.5", tone)}>
          <Icon className="size-3.5" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {snapshot?.killSwitch.ok && snapshot.killSwitch.data.conflict
          ? "Çelişki: DB ve config/kill-switch.json farklı. Fail-safe: kill switch AÇIK, otonomi kapalı. Ajan dosyayı yazmaz; Owner dosyayı DB ile hizalar veya PATCH /api/system/kill-switch kullanır."
          : "Operasyon otoritesi: API/DB kill switch (fail-safe). config/kill-switch.json yalnızca Cursor hook'ları içindir. Ajan dosyayı yazmaz."}
      </TooltipContent>
    </Tooltip>
  );
}

export function SnapshotRefresh() {
  const { lastUpdated, refresh, error } = useSnapshot();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden md:inline">{error ? "Güncellenemedi" : `Son güncelleme ${formatTime(lastUpdated)}`}</span>
      <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Sistem durumunu yenile">
        <RefreshCw className="size-3.5" />
      </Button>
    </div>
  );
}
