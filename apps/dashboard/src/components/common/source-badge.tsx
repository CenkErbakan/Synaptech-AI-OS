import { SOURCE_LABELS, type DataSource } from "@synaptech/shared";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

const SOURCE_STYLES: Record<DataSource, string> = {
  demo: "border-demo/50 bg-demo/15 text-demo",
  config: "border-brand-blue/35 bg-brand-blue/10 text-info",
  "cursor-hook": "border-success/35 bg-success/10 text-success",
  "repo-file": "border-success/35 bg-success/10 text-success",
  api: "border-success/35 bg-success/10 text-success",
  manual: "border-info/35 bg-info/10 text-info",
  "not-connected": "border-border bg-muted/60 text-muted-foreground",
  unverifiable: "border-warning/35 bg-warning/10 text-warning",
};

export function SourceBadge({
  source,
  label,
  className,
}: {
  source: DataSource;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("font-medium", SOURCE_STYLES[source], className)}>
      {label ?? SOURCE_LABELS[source]}
    </Badge>
  );
}
