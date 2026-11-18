import { getEnv } from "../lib/env.js";
import { writeAudit } from "./audit.js";
import { parseLeadCrm } from "./crm-lead.js";
import { assertOwnerGrant } from "./owner-grants.js";

export type OutreachResult = {
  sent: false;
  blocked: boolean;
  networkAttempted: boolean;
  reason: string;
};

const lastSent = new Map<string, number>();

export async function sendCustomerOutreach(input: {
  leadId: string;
  companyName: string;
  to: string;
  subject: string;
  body: string;
  notes?: string | null;
}): Promise<OutreachResult> {
  const env = getEnv();
  const grant = await assertOwnerGrant("customerOutreach");
  if (!grant.ok) {
    return { sent: false, blocked: true, networkAttempted: false, reason: grant.reason };
  }
  const crm = parseLeadCrm(input.notes);
  if (crm.outreachConsent !== "allowed") {
    return { sent: false, blocked: true, networkAttempted: false, reason: "outreach_consent_not_allowed" };
  }
  const prev = lastSent.get(input.leadId);
  if (prev && Date.now() - prev < 7 * 24 * 60 * 60 * 1000) {
    return { sent: false, blocked: true, networkAttempted: false, reason: "duplicate_outreach_window" };
  }
  if (env.EMAIL_OUTREACH_MODE !== "live") {
    await writeAudit({
      category: "growth",
      action: "ops.outreach_blocked",
      actorKind: "system",
      summary: `Müşteri ileti gönderilmedi: mode=${env.EMAIL_OUTREACH_MODE}`,
      metadata: { leadId: input.leadId, mode: env.EMAIL_OUTREACH_MODE, realSend: false },
    });
    return {
      sent: false,
      blocked: true,
      networkAttempted: false,
      reason: `email_outreach_mode_${env.EMAIL_OUTREACH_MODE}`,
    };
  }
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    return { sent: false, blocked: true, networkAttempted: false, reason: "smtp_not_configured" };
  }
  if (!env.SMTP_PASSWORD) {
    return { sent: false, blocked: true, networkAttempted: false, reason: "smtp_password_missing" };
  }
  return { sent: false, blocked: true, networkAttempted: false, reason: "live_send_requires_owner_execute" };
}
