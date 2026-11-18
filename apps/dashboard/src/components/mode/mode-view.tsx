"use client";

import { ViewSkeleton } from "@/components/common/page-parts";
import { useViewMode } from "@/components/providers/view-mode-provider";

/** Gerçek ve DEMO görünümlerinden yalnızca biri çizilir; mod bilinene kadar ikisi de çizilmez. */
export function ModeView({ real, demo }: { real: React.ReactNode; demo: React.ReactNode }) {
  const { mode } = useViewMode();
  if (mode === null) return <ViewSkeleton />;
  return <>{mode === "demo" ? demo : real}</>;
}
