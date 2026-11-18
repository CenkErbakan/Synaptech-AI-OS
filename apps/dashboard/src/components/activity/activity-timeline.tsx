"use client";

import {
  ACTIVITY_KIND_LABELS,
  type ActivityEvent,
} from "@synaptech/shared";
import { cn } from "cn";

import { SourceBadge } from "@/components/common/source-badge";
import { formatDateTime, formatRelative } from "@/lib/format";

export function ActivityTimeline({
  events,
  now = new Date(),
  emptyTitle = "Henüz faaliyet yok",
  emptyDescription,
}: {
  events: ActivityEvent[];
  now?: Date;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{emptyTitle}</p>
        {emptyDescription ? <p className="mt-1 text-xs">{emptyDescription}</p> : null}
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < events.length - 1 ? (
            <span className="absolute top-3 left-[7px] h-[calc(100%-4px)] w-px bg-border" aria-hidden />
          ) : null}
          <span
            className={cn(
              "relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-background",
              event.severity === "critical" && "bg-destructive",
              event.severity === "warning" && "bg-warning",
              event.severity === "info" && "bg-primary",
            )}
          />
          <div className="min-w-0 flex-1 space-y-1 rounded-lg border border-border/70 bg-card/50 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={event.source} />
              <span className="text-[11px] text-muted-foreground">{ACTIVITY_KIND_LABELS[event.kind]}</span>
              <span className="text-[11px] text-muted-foreground">·</span>
              <span className="text-[11px] text-muted-foreground" title={formatDateTime(event.at)}>
                {formatRelative(event.at, now)}
              </span>
            </div>
            <p className="text-sm font-medium leading-snug">{event.title}</p>
            {event.detail ? <p className="text-xs leading-relaxed text-muted-foreground">{event.detail}</p> : null}
            <p className="text-[11px] text-muted-foreground/90">
              {event.actorLabel}
              {event.projectSlug ? ` · ${event.projectSlug}` : ""}
              {event.taskId ? ` · ${event.taskId}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
