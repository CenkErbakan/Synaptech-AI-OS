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
      label = enabled ? "Kill switch: AÇIK" : "Kill switch: kapalı";
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
        {
          "Kaynak: config/kill-switch.json (salt okunur). Açıkken Cursor hook'ları yeni alt ajanları ve okuma dışındaki tüm araçları reddeder. Yalnızca siz, dosyayı elle düzenleyerek değiştirebilirsiniz."
        }
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
