"use client";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ViewModeProvider } from "./view-mode-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ViewModeProvider>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </ViewModeProvider>
  );
}
