export type LeadCrmProfile = {
  productFit: "synaptech-ai-os" | "synaptech-website" | "subify" | "marivo" | "unknown";
  contactChannel: "email" | "linkedin" | "web-form" | "none";
  outreachConsent: "unknown" | "allowed" | "denied";
  salesStage: "research" | "qualified" | "contacted" | "negotiation" | "won" | "lost";
  lastTouchAt: string | null;
};

export const DEFAULT_LEAD_CRM: LeadCrmProfile = {
  productFit: "unknown",
  contactChannel: "none",
  outreachConsent: "unknown",
  salesStage: "research",
  lastTouchAt: null,
};

const PREFIX = "crmjson:";

export function parseLeadCrm(notes: string | null | undefined): LeadCrmProfile {
  if (!notes) return { ...DEFAULT_LEAD_CRM };
  const idx = notes.indexOf(PREFIX);
  if (idx < 0) return { ...DEFAULT_LEAD_CRM };
  try {
    const raw = notes.slice(idx + PREFIX.length).trim();
    const jsonEnd = raw.indexOf("\n");
    const payload = jsonEnd >= 0 ? raw.slice(0, jsonEnd) : raw;
    return { ...DEFAULT_LEAD_CRM, ...(JSON.parse(payload) as Partial<LeadCrmProfile>) };
  } catch {
    return { ...DEFAULT_LEAD_CRM };
  }
}

export function embedLeadCrm(notes: string | null | undefined, crm: Partial<LeadCrmProfile>): string {
  const next = { ...parseLeadCrm(notes), ...crm };
  const rest = (notes ?? "").replace(new RegExp(`${PREFIX}\\{.*\\}`, "s"), "").trim();
  return `${rest}\n${PREFIX}${JSON.stringify(next)}`.trim();
}
