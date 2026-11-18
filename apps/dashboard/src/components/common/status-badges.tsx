import {
  AGENT_STATUS_LABELS,
  EFFECTIVE_APPROVAL_STATUS_LABELS,
  PRIORITY_LABELS,
  RISK_LABELS,
  TASK_STATUS_LABELS,
  type AgentStatus,
  type EffectiveApprovalStatus,
  type Priority,
  type RiskLevel,
  type TaskStatus,
} from "@synaptech/shared";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

const AGENT_STATUS_STYLES: Record<AgentStatus, string> = {
  working: "border-primary/40 bg-primary/15 text-primary",
  awaiting_approval: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  completed: "border-success/40 bg-success/10 text-success",
  idle: "border-border bg-muted/60 text-muted-foreground",
  disabled: "border-border bg-muted/40 text-muted-foreground line-through",
};

export function AgentStatusBadge({ status, label }: { status: AgentStatus; label?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", AGENT_STATUS_STYLES[status])}>
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "working" && "animate-pulse",
        )}
      />
      {label ?? AGENT_STATUS_LABELS[status]}
    </Badge>
  );
}

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  backlog: "border-border bg-muted/60 text-muted-foreground",
  planned: "border-info/40 bg-info/10 text-info",
  in_progress: "border-primary/40 bg-primary/15 text-primary",
  testing: "border-brand-blue/40 bg-brand-blue/15 text-info",
  in_review: "border-chart-3/40 bg-chart-3/10 text-info",
  awaiting_approval: "border-warning/40 bg-warning/10 text-warning",
  done: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted/40 text-muted-foreground line-through",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={TASK_STATUS_STYLES[status]}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<Priority, string> = {
  low: "border-border text-muted-foreground",
  medium: "border-info/40 text-info",
  high: "border-warning/40 text-warning",
  critical: "border-destructive/50 text-destructive",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="outline" className={PRIORITY_STYLES[priority]}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const RISK_STYLES: Record<RiskLevel, string> = {
  low: "border-border bg-muted/50 text-muted-foreground",
  medium: "border-info/40 bg-info/10 text-info",
  high: "border-warning/40 bg-warning/10 text-warning",
  critical: "border-destructive/50 bg-destructive/15 text-destructive",
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <Badge variant="outline" className={RISK_STYLES[risk]}>
      Risk: {RISK_LABELS[risk]}
    </Badge>
  );
}

const APPROVAL_STYLES: Record<EffectiveApprovalStatus, string> = {
  pending: "border-warning/40 bg-warning/10 text-warning",
  approved: "border-success/40 bg-success/10 text-success",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  executed: "border-success/40 bg-success/15 text-success",
  invalidated: "border-destructive/40 bg-destructive/10 text-destructive",
  expired: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

export function ApprovalStatusBadge({ status }: { status: EffectiveApprovalStatus }) {
  return (
    <Badge variant="outline" className={cn("h-auto whitespace-normal py-0.5 text-left", APPROVAL_STYLES[status])}>
      {EFFECTIVE_APPROVAL_STATUS_LABELS[status]}
    </Badge>
  );
}
