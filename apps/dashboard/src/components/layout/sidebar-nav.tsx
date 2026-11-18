"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "cn";
import { Sparkles } from "lucide-react";

import { useSnapshot } from "@/components/providers/snapshot-provider";

import { NAV_ITEMS, isActivePath } from "./nav-items";

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 px-3" aria-label="Ana menü">
      {NAV_ITEMS.map((item) => {
        const active = pathname !== null && isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground ring-1 ring-primary/30",
            )}
          >
            <item.icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** usePathname, parametresi önceden bilinmeyen rotalarda askıya alınır; Suspense içinde çağrılır. */
function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavLinks pathname={pathname} onNavigate={onNavigate} />;
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { snapshot } = useSnapshot();
  const phase = snapshot?.systemStatus.ok ? snapshot.systemStatus.data.phase.label : "Faz durumu okunuyor…";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-violet to-brand-blue text-white shadow-lg shadow-brand-violet/30">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold">SynapTech AI OS</p>
          <p className="truncate text-[11px] text-muted-foreground">{phase}</p>
        </div>
      </div>

      <Suspense fallback={<NavLinks pathname={null} onNavigate={onNavigate} />}>
        <ActiveNavLinks onNavigate={onNavigate} />
      </Suspense>

      <div className="space-y-1 px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
        <p>Yerel panel · 127.0.0.1:3100</p>
        <p>Production bağlantısı yok · Push yok</p>
      </div>
    </div>
  );
}

export function CurrentSectionTitle() {
  const pathname = usePathname();
  const current = NAV_ITEMS.find((item) => isActivePath(pathname, item.href));
  return <>{current?.label ?? "SynapTech AI OS"}</>;
}
