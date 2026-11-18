export type LeadCrmProfile = {
  productFit: "synaptech-ai-os" | "synaptech-website" | "subify" | "marivo" | "unknown";
  contactChannel: "email" | "linkedin" | "web-form" | "none";
  outreachConsent: "unknown" | "allowed" | "denied";
  salesStage: "research" | "qualified" | "contacted" | "negotiation" | "won" | "lost";
  lastTouchAt: string | null;
  verifiedSource: boolean;
  qualifiedLead: boolean;
  outreachEligible: boolean;
};

export const DEFAULT_LEAD_CRM: LeadCrmProfile = {
  productFit: "unknown",
  contactChannel: "none",
  outreachConsent: "unknown",
  salesStage: "research",
  lastTouchAt: null,
  verifiedSource: false,
  qualifiedLead: false,
  outreachEligible: false,
};

const CHAMBER =
  /\b(oda|chamber|borsa|tobb|ebso|izto|sanayi odası|ticaret odası)\b/i;

const PRODUCT_HINTS: Record<string, RegExp> = {
  marivo: /\b(reklam|ads|kampanya|pazarlama otomasyon|creative)\b/i,
  subify: /\b(altyazı|subtitle|video|dublaj|dubbing)\b/i,
  synaptech: /\b(yazılım|erp|crm|portal|otomasyon|web sitesi)\b/i,
  "synaptech-ai-os": /\b(ajan|agent os|otonom)\b/i,
};

export function qualifyPublicLead(input: {
  companyName: string;
  needSignal: string;
  projectSlug: string;
  sourceOk: boolean;
}): Pick<LeadCrmProfile, "productFit" | "verifiedSource" | "qualifiedLead" | "outreachEligible" | "salesStage"> {
  const blob = `${input.companyName}\n${input.needSignal}`;
  const chamber = CHAMBER.test(blob);
  const fitKey =
    input.projectSlug === "marivo"
      ? "marivo"
      : input.projectSlug === "subify"
        ? "subify"
        : input.projectSlug === "synaptech-ai-os"
          ? "synaptech-ai-os"
          : "synaptech";
  const productHit = PRODUCT_HINTS[fitKey]?.test(blob) ?? false;
  const verifiedSource = input.sourceOk;
  const qualifiedLead = verifiedSource && !chamber && productHit;
  return {
    productFit:
      fitKey === "synaptech"
        ? "synaptech-website"
        : (fitKey as LeadCrmProfile["productFit"]),
    verifiedSource,
    qualifiedLead,
    outreachEligible: false,
    salesStage: qualifiedLead ? "qualified" : "research",
  };
}

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
