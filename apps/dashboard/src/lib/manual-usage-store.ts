"use client";

import { useEffect } from "react";

import { ManualUsageEntrySchema, type ManualUsageEntry } from "@synaptech/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface ManualUsageState {
  entries: ManualUsageEntry[];
  hydrated: boolean;
  add: (entry: ManualUsageEntry) => void;
  remove: (id: string) => void;
}

/** Kullanıcının Cursor ayarlarından elle girdiği kullanım değerleri (kaynak: manuel). Tarayıcıda tutulur. */
export const useManualUsageStore = create<ManualUsageState>()(
  persist(
    (set) => ({
      entries: [],
      hydrated: false,
      add: (entry) => set((state) => ({ entries: [entry, ...state.entries] })),
      remove: (id) => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
    }),
    {
      name: "synaptech-manual-usage-v1",
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      skipHydration: true,
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => {
        const raw = (persisted as { entries?: unknown } | undefined)?.entries;
        const entries = Array.isArray(raw)
          ? raw.flatMap((item) => {
              const parsed = ManualUsageEntrySchema.safeParse(item);
              return parsed.success ? [parsed.data] : [];
            })
          : [];
        return { ...current, entries };
      },
      onRehydrateStorage: () => () => {
        useManualUsageStore.setState({ hydrated: true });
      },
    },
  ),
);

export function useManualUsage() {
  const entries = useManualUsageStore((state) => state.entries);
  const hydrated = useManualUsageStore((state) => state.hydrated);

  useEffect(() => {
    if (!useManualUsageStore.persist.hasHydrated()) void useManualUsageStore.persist.rehydrate();
  }, []);

  return { entries, hydrated };
}
