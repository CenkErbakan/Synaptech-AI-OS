"use client";

import {
  AGENT_STATUS_LABELS,
  deriveAgentStatusFromTasks,
  selectDemo,
  type AgentId,
} from "@synaptech/shared";
import { Bot } from "lucide-react";

import { AgentIcon } from "@/components/common/agent-icon";
import { EmptyState } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { AgentStatusBadge } from "@/components/common/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemoDataset } from "@/lib/demo/store";

const DEMO_AGENTS: Array<{ id: AgentId; name: string; department: string; summary: string }> = [
  { id: "ceo", name: "AI CEO", department: "Yönetim", summary: "Hedefleri takip eder ve görev önerir." },
  { id: "cto", name: "AI CTO", department: "Yazılım", summary: "Mimari ve kod incelemesi yapar." },
  { id: "developer", name: "AI Developer", department: "Yazılım", summary: "Kod geliştirir ve PR taslağı hazırlar." },
  { id: "tester", name: "AI Tester", department: "Yazılım", summary: "Test yazar ve çalıştırır." },
  { id: "security", name: "AI Security", department: "Yazılım", summary: "Güvenlik denetimi yapar." },
  { id: "growth-lead", name: "AI Growth Lead", department: "Büyüme", summary: "Büyüme stratejisini koordine eder." },
  { id: "seo-specialist", name: "AI SEO Specialist", department: "Büyüme", summary: "SEO fırsatlarını belirler." },
  { id: "content-manager", name: "AI Content Manager", department: "Büyüme", summary: "Blog taslakları hazırlar." },
  { id: "ads-manager", name: "AI Ads Manager", department: "Büyüme", summary: "Reklam önerileri üretir." },
];

export function AgentsDemo() {
  const { dataset, ready } = useDemoDataset();
  if (!ready || !dataset) return <EmptyState icon={Bot} title="DEMO verisi yükleniyor…" />;

  const tasks = selectDemo(dataset.tasks, "ajan kartları");
  const now = new Date();

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {DEMO_AGENTS.map((agent) => {
        const status = deriveAgentStatusFromTasks(agent.id, tasks, { enabled: true, now });
        const current = tasks.find((task) => task.id === status.currentTaskId);
        const completed = tasks.filter((task) => task.assignee === agent.id && task.status === "done").length;
        return (
          <Card key={agent.id}>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <AgentIcon agentId={agent.id} />
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">{agent.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{agent.department}</p>
              </div>
              <AgentStatusBadge status={status.status} label={AGENT_STATUS_LABELS[status.status]} />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{agent.summary}</p>
              <SourceBadge source="demo" />
              <p className="text-xs text-muted-foreground">
                Görev: {current?.title ?? "Yok"} · Tamamlanan: {completed}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
