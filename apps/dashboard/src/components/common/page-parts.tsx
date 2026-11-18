import type { DataSource } from "@synaptech/shared";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { SourceBadge } from "./source-badge";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  sources = [],
  children,
}: {
  title: string;
  description?: string;
  sources?: DataSource[];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-0.5">
        <h2 className="font-heading text-base font-medium">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map((source) => (
          <SourceBadge key={source} source={source} />
        ))}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  source,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  source: DataSource;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <Card size="sm" className="bg-card/80">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Icon className="size-4" />
          </span>
          <SourceBadge source={source} />
        </div>
        <div className="space-y-0.5">
          <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground/80">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function LoadErrorNotice({ path, error }: { path: string; error: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span className="font-medium">{path}</span> okunamadı: {error}
    </div>
  );
}

export function ViewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
