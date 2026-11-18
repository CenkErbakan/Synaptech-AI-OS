"use client";

import { Suspense, useState } from "react";

import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

import { DemoFrame } from "./demo-frame";
import { KillSwitchIndicator, SnapshotRefresh, ViewModeToggle } from "./header-controls";
import { PhaseStrip } from "./phase-strip";
import { CurrentSectionTitle, SidebarContent } from "./sidebar-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-sidebar-border bg-sidebar/85 backdrop-blur lg:block">
        <SidebarContent />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Ana menü</SheetTitle>
          <SheetDescription className="sr-only">SynapTech AI OS bölümleri</SheetDescription>
          <SidebarContent onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu />
          </Button>
          <p className="truncate font-heading text-sm font-medium">
            <Suspense fallback="SynapTech AI OS">
              <CurrentSectionTitle />
            </Suspense>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <SnapshotRefresh />
            <div className="hidden sm:block">
              <KillSwitchIndicator />
            </div>
            <ViewModeToggle />
          </div>
        </header>
        <PhaseStrip />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <DemoFrame>{children}</DemoFrame>
        </main>
      </div>
    </div>
  );
}
