"use client";

import { cn } from "cn";
import { CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";

import { SourceBadge } from "@/components/common/source-badge";
import { useSnapshot } from "@/components/providers/snapshot-provider";

const INTEGRATION_LABELS: Record<string, string> = {
  none: "yok",
  not_connected: "bağlı değil",
  not_installed: "kurulmadı",
  connected: "bağlı",
};

const GUARD_LABELS = {
  enforce: "Guard: zorunlu",
  observe: "Guard: gözlem modu",
  none: "Guard: etkin değil",
} as const;

type ObservedStrip = {
  configCursor: string;
  configGithub: string;
  cursorObserved: string;
  githubObserved: string;
  githubVerified: string[];
  cloudLive: boolean;
  pastCloudPilot: boolean;
  schedulerMode: string;
  generatedAt?: string;
};

export function PhaseStrip() {
  const { snapshot, error } = useSnapshot();
  const [live, setLive] = useState<ObservedStrip | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/control/integrations/status", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setLive(null);
            setApiError(`API ${res.status}`);
          }
          return;
        }
        const json = (await res.json()) as {
          generatedAt?: string;
          configDeclaredStatus?: { cursor?: string; github?: string };
          observedRuntimeStatus?: {
            cursor?: {
              label?: string;
              liveEnabled?: boolean;
              pastPilotExists?: boolean;
              credentialConfigured?: boolean;
            };
            github?: { label?: string };
            projects?: Array<{ slug: string; verified: boolean }>;
          };
          modesUnchanged?: { schedulerAiCeoMode?: string };
        };
        if (cancelled) return;
        setApiError(null);
        const obs = json.observedRuntimeStatus;
        setLive({
          configCursor: json.configDeclaredStatus?.cursor ?? "none",
          configGithub: json.configDeclaredStatus?.github ?? "not_connected",
          cursorObserved: obs?.cursor?.label ?? "Cursor: gözlem yok",
          githubObserved: obs?.github?.label ?? "GitHub: gözlem yok",
          githubVerified: (obs?.projects ?? []).filter((p) => p.verified).map((p) => p.slug),
          cloudLive: Boolean(obs?.cursor?.liveEnabled),
          pastCloudPilot: Boolean(obs?.cursor?.pastPilotExists),
          schedulerMode: json.modesUnchanged?.schedulerAiCeoMode ?? "off",
          generatedAt: json.generatedAt,
        });
      } catch {
        if (!cancelled) {
          setLive(null);
          setApiError("API erişilemiyor");
        }
      }
    }
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (error || !snapshot) {
    return (
      <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
        {error ?? "Faz durumu okunuyor…"}
      </div>
    );
  }

  const status = snapshot.systemStatus;
  const parts: string[] = [];
  if (status.ok) {
    const { phase, autonomy } = status.data;
    parts.push(`Faz ${phase.current}/${phase.total} (config)`);
    parts.push(`Otonom çalışma: ${autonomy === "enabled" ? "açık" : "kapalı"}`);
  } else {
    parts.push("config/system-status.yaml okunamadı");
  }

  if (apiError) {
    parts.push(`Canlı API: ${apiError}`);
  } else if (live) {
    parts.push(
      `Config Cursor: ${INTEGRATION_LABELS[live.configCursor] ?? live.configCursor}`,
    );
    parts.push(
      `Config GitHub App: ${INTEGRATION_LABELS[live.configGithub] ?? live.configGithub}`,
    );
    parts.push(`Gözlem · ${live.cursorObserved}`);
    parts.push(`Gözlem · ${live.githubObserved}`);
    parts.push(
      live.githubVerified.length
        ? `Verified repo: ${live.githubVerified.join(", ")}`
        : "Verified repo: yok",
    );
    parts.push(
      live.cloudLive
        ? "Cloud live: açık"
        : live.pastCloudPilot
          ? "Cloud: geçmiş pilot · live kapalı"
          : "Cloud live: kapalı",
    );
    parts.push(`Scheduler AI: ${live.schedulerMode}`);
  }

  parts.push(GUARD_LABELS[snapshot.guard.mode]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
      <CircleDashed className="size-3.5 text-primary" />
      {parts.map((part, index) => (
        <span
          key={`${part}-${index}`}
          className={cn(index > 0 && "before:mr-3 before:text-border before:content-['·']")}
        >
          {part}
        </span>
      ))}
      <SourceBadge source={live ? "api" : "config"} className="ml-auto" />
    </div>
  );
}
