import { z } from "zod";

import type { AgentId } from "./agents";
import type { Sourced } from "./source";

/** `content/blog/drafts/{tr,en}/*.md` dosyalarının frontmatter'ı (gerçek dosyalar). */
export const ContentDraftFrontmatterSchema = z.object({
  title: z.string().min(1),
  lang: z.enum(["tr", "en"]),
  project: z.string().default("synaptech"),
  slug: z.string().optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  status: z.string().default("draft"),
  seo_review: z.enum(["pending", "passed", "changes_requested"]).default("pending"),
  publish_approval: z.enum(["pending", "approved", "rejected"]).default("pending"),
  created_at: z.string().optional(),
});

export type ContentDraftFrontmatter = z.infer<typeof ContentDraftFrontmatterSchema>;

/** `reports/**`, `marketing/**`, `tasks/**` belgelerinin ortak frontmatter alanları. */
export const DocumentFrontmatterSchema = z.object({
  title: z.string().optional(),
  type: z.string().optional(),
  project: z.string().optional(),
  agent: z.string().optional(),
  date: z.string().optional(),
  status: z.string().optional(),
});

export type DocumentFrontmatter = z.infer<typeof DocumentFrontmatterSchema>;

export const SEO_REVIEW_LABELS = {
  pending: "SEO kontrolü bekliyor",
  passed: "SEO kontrolü geçti",
  changes_requested: "SEO değişiklik istedi",
} as const;

export const PUBLISH_APPROVAL_LABELS = {
  pending: "Yayın onayı bekliyor",
  approved: "Yayın onaylandı",
  rejected: "Yayın reddedildi",
} as const;

export type AdPlatform = "google_ads" | "meta_ads";

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
};

export interface DemoSeoTask extends Sourced {
  id: string;
  title: string;
  page: string;
  impact: "high" | "medium" | "low";
  status: "proposed" | "planned" | "in_progress" | "done";
}

export interface DemoKeywordIdea extends Sourced {
  id: string;
  keyword: string;
  lang: "tr" | "en";
  intent: "bilgi" | "karşılaştırma" | "satın alma";
  note: string;
}

export interface DemoCalendarEntry extends Sourced {
  id: string;
  week: string;
  topic: string;
  lang: "tr" | "en";
  owner: AgentId;
  status: "planned" | "drafting" | "in_review";
}

export interface DemoDraft extends Sourced {
  id: string;
  title: string;
  lang: "tr" | "en";
  metaTitle: string;
  metaDescription: string;
  seoReview: ContentDraftFrontmatter["seo_review"];
  publishApproval: ContentDraftFrontmatter["publish_approval"];
}

export interface DemoCampaignProposal extends Sourced {
  id: string;
  platform: AdPlatform;
  name: string;
  objective: string;
  audience: string;
  status: "draft" | "awaiting_approval";
}

export interface DemoAdCopy extends Sourced {
  id: string;
  platform: AdPlatform;
  headline: string;
  description: string;
  status: "draft" | "in_review";
}

export interface DemoBudgetSuggestion extends Sourced {
  id: string;
  platform: AdPlatform;
  suggestion: string;
  rationale: string;
  status: "proposal" | "awaiting_approval";
}

export interface DemoGrowthData {
  seoTasks: DemoSeoTask[];
  keywordIdeas: DemoKeywordIdea[];
  calendar: DemoCalendarEntry[];
  drafts: DemoDraft[];
  campaignProposals: DemoCampaignProposal[];
  adCopies: DemoAdCopy[];
  budgetSuggestions: DemoBudgetSuggestion[];
}
