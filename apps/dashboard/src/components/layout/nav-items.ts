import {
  Activity,
  BadgeCheck,
  Bot,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Genel Bakış", icon: LayoutDashboard },
  { href: "/ajanlar", label: "AI Çalışanları", icon: Bot },
  { href: "/gorevler", label: "Görev Panosu", icon: SquareKanban },
  { href: "/aktivite", label: "Canlı Aktivite", icon: Activity },
  { href: "/otonomi", label: "Otonom Faaliyet", icon: Sparkles },
  { href: "/ekip-iletisim", label: "AI Ekip İletişimi", icon: MessagesSquare },
  { href: "/ceo-chat", label: "AI CEO Chat", icon: MessageSquare },
  { href: "/onaylar", label: "Onay Merkezi", icon: BadgeCheck },
  { href: "/yetkiler", label: "Yetkiler", icon: ShieldCheck },
  { href: "/projeler", label: "Projeler", icon: FolderKanban },
  { href: "/buyume", label: "Büyüme Paneli", icon: TrendingUp },
  { href: "/kullanim", label: "Kullanım ve Maliyet", icon: Gauge },
  { href: "/guvenlik", label: "Güvenlik", icon: ShieldCheck },
];

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
