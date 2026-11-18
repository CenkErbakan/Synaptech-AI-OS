import { z } from "zod";

import type { ActivityEvent, ActivityKind, Severity } from "./activity";
import { isAgentId } from "./agents";

/** `.cursor/hooks/guard.mjs` her satıra bu biçimde bir JSON nesnesi yazar (`.synaptech/audit/*.jsonl`). */
export const AUDIT_DECISIONS = ["allow", "deny", "ask", "observe", "info", "error"] as const;

export const AuditEventSchema = z.object({
  v: z.literal(1),
  ts: z.string().min(1),
  event: z.string().min(1),
  mode: z.enum(["observe", "enforce"]).optional(),
  decision: z.enum(AUDIT_DECISIONS),
  category: z.string().optional(),
  reason: z.string().optional(),
  tool: z.string().optional(),
  target: z.string().optional(),
  conversation: z.string().optional(),
  subagent: z
    .object({
      id: z.string().optional(),
      type: z.string(),
      model: z.string().optional(),
      status: z.string().optional(),
      durationMs: z.number().optional(),
      toolCalls: z.number().optional(),
      modifiedFiles: z.number().optional(),
      task: z.string().optional(),
    })
    .optional(),
  observed: z
    .object({
      toolName: z.string().optional(),
      inputKeys: z.array(z.string()).optional(),
    })
    .optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const SubagentStateSchema = z.object({
  v: z.literal(1),
  active: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      model: z.string().optional(),
      parent: z.string().optional(),
      taskHash: z.string().optional(),
      task: z.string().optional(),
      startedAt: z.string(),
    }),
  ),
  launches: z.record(z.string(), z.object({ count: z.number(), first: z.string() })),
});

export type SubagentState = z.infer<typeof SubagentStateSchema>;

export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  "git-push": "git push",
  "git-protected-branch": "korumalı branch",
  "git-bypass": "git kancası atlatma",
  "git-remote": "remote değişikliği",
  "git-destructive": "yıkıcı git komutu",
  "gh-write": "GitHub yazma işlemi",
  "deploy-cli": "deploy aracı",
  "cloud-cli": "bulut CLI",
  "remote-access": "uzak erişim",
  publish: "paket/imaj yayını",
  database: "veritabanı komutu",
  "db-destructive": "yıkıcı SQL",
  "secret-access": "gizli bilgi erişimi",
  "env-dump": "ortam değişkeni dökümü",
  "protected-path": "korumalı yol",
  "outside-workspace": "çalışma alanı dışı",
  "kill-switch": "kill switch",
  "privilege-escalation": "yetki yükseltme",
  persistence: "kalıcı zamanlanmış görev",
  "system-config": "sistem yapılandırması",
  obfuscation: "gizlenmiş komut",
  "agent-cli": "ek ajan başlatma",
  network: "ağ isteği",
  "package-install": "paket kurulumu",
  container: "konteyner",
  "recursive-delete": "özyinelemeli silme",
  concurrency: "eşzamanlılık sınırı",
  "launch-budget": "oturum başına alt ajan sınırı",
  "model-policy": "model politikası",
  mcp: "MCP sunucusu",
  "prompt-secret": "istemde gizli anahtar",
  "guard-error": "guard iç hatası",
};

export function auditCategoryLabel(category: string | undefined): string {
  if (!category) return "genel";
  return AUDIT_CATEGORY_LABELS[category] ?? category;
}

interface AuditDescription {
  kind: ActivityKind;
  severity: Severity;
  title: string;
  detail?: string;
}

function subagentStopTitle(type: string, status: string | undefined): string {
  if (status === "error") return `${type} alt ajanı hatayla bitti`;
  if (status === "aborted") return `${type} alt ajanı durduruldu`;
  return `${type} alt ajanı tamamlandı`;
}

export function describeAuditEvent(event: AuditEvent): AuditDescription {
  const category = auditCategoryLabel(event.category);
  const subagentType = event.subagent?.type ?? "bilinmeyen";

  if (event.decision === "error") {
    return { kind: "security", severity: "critical", title: "Guard iç hatası", detail: event.reason };
  }

  switch (event.event) {
    case "subagentStart":
      if (event.decision === "deny") {
        return {
          kind: "security",
          severity: "warning",
          title: `${subagentType} alt ajanı başlatılmadı (${category})`,
          detail: event.reason,
        };
      }
      return {
        kind: "agent",
        severity: "info",
        title: `${subagentType} alt ajanı başlatıldı`,
        detail: [event.subagent?.model && `Model: ${event.subagent.model}`, event.subagent?.task]
          .filter(Boolean)
          .join(" · "),
      };
    case "subagentStop": {
      const parts = [
        event.subagent?.durationMs !== undefined && `Süre: ${Math.round(event.subagent.durationMs / 1000)} sn`,
        event.subagent?.toolCalls !== undefined && `Araç çağrısı: ${event.subagent.toolCalls}`,
        event.subagent?.modifiedFiles !== undefined && `Değişen dosya: ${event.subagent.modifiedFiles}`,
      ].filter(Boolean);
      return {
        kind: "agent",
        severity: event.subagent?.status === "error" ? "warning" : "info",
        title: subagentStopTitle(subagentType, event.subagent?.status),
        detail: parts.join(" · "),
      };
    }
    case "beforeShellExecution":
      if (event.decision === "deny") {
        return { kind: "security", severity: "warning", title: `Kabuk komutu reddedildi (${category})`, detail: [event.target, event.reason].filter(Boolean).join(" — ") };
      }
      if (event.decision === "ask") {
        return { kind: "security", severity: "info", title: `Kabuk komutu için onay istendi (${category})`, detail: event.target };
      }
      break;
    case "preToolUse":
      if (event.decision === "deny") {
        return { kind: "security", severity: "warning", title: `${event.tool ?? "Araç"} işlemi reddedildi (${category})`, detail: [event.target, event.reason].filter(Boolean).join(" — ") };
      }
      break;
    case "beforeMCPExecution":
      if (event.decision === "deny" || event.decision === "ask") {
        return { kind: "security", severity: event.decision === "deny" ? "warning" : "info", title: `MCP çağrısı ${event.decision === "deny" ? "reddedildi" : "onaya sunuldu"}`, detail: [event.target, event.reason].filter(Boolean).join(" — ") };
      }
      break;
    case "beforeSubmitPrompt":
      if (event.decision === "deny") {
        return { kind: "security", severity: "critical", title: "İstem gönderimi durduruldu: gizli anahtar kalıbı", detail: event.reason };
      }
      break;
    case "sessionStart":
      return { kind: "system", severity: "info", title: "Cursor ajan oturumu başladı" };
    case "stop":
      return { kind: "system", severity: "info", title: "Ajan döngüsü sona erdi", detail: event.reason };
  }

  if (event.decision === "observe") {
    return { kind: "system", severity: "info", title: `Gözlem: ${event.observed?.toolName ?? event.event}`, detail: event.observed?.inputKeys?.join(", ") };
  }

  return {
    kind: "system",
    severity: "info",
    title: `${event.event}: ${event.decision}`,
    detail: [event.target, event.reason].filter(Boolean).join(" — ") || undefined,
  };
}

export function auditEventToActivity(event: AuditEvent, index: number): ActivityEvent {
  const description = describeAuditEvent(event);
  const agentType = event.subagent?.type;
  return {
    id: `audit:${event.ts}:${index}`,
    source: "cursor-hook",
    at: event.ts,
    kind: description.kind,
    severity: description.severity,
    actorLabel: agentType ? `Cursor · ${agentType}` : "Cursor",
    agentId: isAgentId(agentType) ? agentType : undefined,
    title: description.title,
    detail: description.detail || undefined,
  };
}
