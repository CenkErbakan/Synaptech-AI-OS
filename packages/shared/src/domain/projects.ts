/** Bilinen proje katalogu — DEMO/UI; gerçek kaynak MSSQL Project tablosudur. */
export const KNOWN_PROJECTS = [
  {
    slug: "synaptech",
    name: "SynapTech",
    kind: "corporate_website",
    description: "Kurumsal web sitesi",
    defaultCloudAgentEnabled: false,
  },
  {
    slug: "subify",
    name: "Subify",
    kind: "product",
    description: "Abonelik ürünü",
    defaultCloudAgentEnabled: false,
  },
  {
    slug: "marivo",
    name: "Marivo",
    kind: "product",
    description: "Pazarlama ürünü",
    defaultCloudAgentEnabled: false,
  },
  {
    slug: "synaptech-ai-os",
    name: "SynapTech AI OS",
    kind: "company_os",
    description: "Şirket işletim sistemi (ajan orkestrasyonu, görev motoru, dashboard)",
    defaultCloudAgentEnabled: false,
  },
] as const;

export type KnownProjectSlug = (typeof KNOWN_PROJECTS)[number]["slug"];

export function isKnownProjectSlug(slug: string): slug is KnownProjectSlug {
  return KNOWN_PROJECTS.some((p) => p.slug === slug);
}
