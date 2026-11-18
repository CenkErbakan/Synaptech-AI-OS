import { getPrisma } from "../db/prisma.js";

const MATERIAL =
  /github yetki|vps|production.?deploy|kritik güvenlik|cve|financial|müşteri fırsat|verified lead|geliştirme önerisi|yeni proje fırsat/i;

/**
 * Owner'a yalnızca önemli kararlar. Küçük görev sonuçları inbox'a düşmez.
 */
export function shouldNotifyOwner(input: {
  agentId: string;
  acceptanceMet: boolean;
  requiresOwnerApproval?: boolean;
  summary: string;
  findingKind?: string;
  codeChangeApplied?: boolean;
  blockedReason?: string | null;
}): boolean {
  const blob = `${input.summary}\n${input.blockedReason ?? ""}`;
  if (/github|git_push|open_pr/i.test(blob) && /grant|yetki|owner/i.test(blob)) return true;
  if (/vps|production.?deploy/i.test(blob)) return true;
  if (input.agentId === "security" && input.acceptanceMet && /cve|kritik/i.test(blob)) return true;
  if (input.agentId === "growth-lead" && input.acceptanceMet && /verified lead|müşteri fırsat/i.test(blob))
    return true;
  if (input.agentId === "developer" && input.codeChangeApplied) return true;
  if (input.agentId === "ceo" && MATERIAL.test(blob)) return true;
  return false;
}

export async function notifyOwnerIfMaterial(input: {
  fromAgent: string;
  taskId: string;
  parentTaskId: string | null;
  summary: string;
  payload?: unknown;
}): Promise<string | null> {
  const prisma = getPrisma();
  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: input.fromAgent,
      toAgentId: "owner",
      taskId: input.taskId,
      parentTaskId: input.parentTaskId,
      kind: "owner_notice",
      summary: input.summary.slice(0, 1000),
      payloadJson: input.payload ? JSON.stringify(input.payload).slice(0, 20_000) : null,
    },
  });
  return msg.id;
}
