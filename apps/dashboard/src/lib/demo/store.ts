"use client";

import { useEffect } from "react";

import { createDemoDataset, type DemoDataset } from "@synaptech/shared/demo";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { isValidDemoDataset, type DemoResult } from "./actions";

interface DemoStoreState {
  dataset: DemoDataset | null;
  hydrated: boolean;
  ensureSeeded: (now: Date) => void;
  reset: (now: Date) => void;
  apply: (operation: (dataset: DemoDataset) => DemoResult) => DemoResult;
}

/** Yalnızca DEMO görünümünde kullanılır; gerçek veri bu depoya asla yazılmaz. */
export const useDemoStore = create<DemoStoreState>()(
  persist(
    (set, get) => ({
      dataset: null,
      hydrated: false,
      ensureSeeded: (now) => {
        if (!get().dataset) set({ dataset: createDemoDataset(now) });
      },
      reset: (now) => set({ dataset: createDemoDataset(now) }),
      apply: (operation) => {
        const dataset = get().dataset;
        if (!dataset) return { ok: false, error: "DEMO verisi henüz yüklenmedi." };
        const result = operation(dataset);
        if (result.ok) set({ dataset: result.dataset });
        return result;
      },
    }),
    {
      name: "synaptech-demo-v1",
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      skipHydration: true,
      partialize: (state) => ({ dataset: state.dataset }),
      merge: (persisted, current) => {
        const dataset = (persisted as { dataset?: unknown } | undefined)?.dataset;
        return { ...current, dataset: isValidDemoDataset(dataset) ? dataset : null };
      },
      onRehydrateStorage: () => () => {
        useDemoStore.setState({ hydrated: true });
      },
    },
  ),
);

let demoIdCounter = 0;

export function newDemoId(): string {
  demoIdCounter += 1;
  return `${Date.now().toString(36)}${demoIdCounter.toString(36)}`;
}

export function useDemoDataset(): { dataset: DemoDataset | null; ready: boolean } {
  const dataset = useDemoStore((state) => state.dataset);
  const hydrated = useDemoStore((state) => state.hydrated);

  useEffect(() => {
    if (!useDemoStore.persist.hasHydrated()) void useDemoStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (hydrated && !dataset) useDemoStore.getState().ensureSeeded(new Date());
  }, [hydrated, dataset]);

  return { dataset, ready: hydrated && dataset !== null };
}
