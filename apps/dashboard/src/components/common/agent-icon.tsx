import type { AgentId } from "@synaptech/shared";
import { cn } from "cn";
import {
  CodeXml,
  Cpu,
  Crown,
  FlaskConical,
  Lock,
  Megaphone,
  PenLine,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  ceo: Crown,
  cto: Cpu,
  developer: CodeXml,
  tester: FlaskConical,
  security: Lock,
  "growth-lead": TrendingUp,
  "seo-specialist": Search,
  "content-manager": PenLine,
  "ads-manager": Megaphone,
};

export function AgentIcon({ agentId, className }: { agentId: AgentId; className?: string }) {
  const Icon = AGENT_ICONS[agentId];
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-violet/30 to-brand-blue/25 text-foreground ring-1 ring-white/10",
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
