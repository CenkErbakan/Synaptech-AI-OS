"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

export type ViewMode = "real" | "demo";

const STORAGE_KEY = "synaptech-view-mode";
const CHANGE_EVENT = "synaptech:view-mode";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSnapshot(): ViewMode {
  return window.localStorage.getItem(STORAGE_KEY) === "demo" ? "demo" : "real";
}

/** Sunucuda ve hidrasyon sırasında mod bilinmez; bu sürede hiçbir moda ait veri çizilmez. */
function getServerSnapshot(): ViewMode | null {
  return null;
}

interface ViewModeContextValue {
  mode: ViewMode | null;
  setMode: (mode: ViewMode) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSyncExternalStore<ViewMode | null>(subscribe, getSnapshot, getServerSnapshot);

  const setMode = useCallback((next: ViewMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  const context = useContext(ViewModeContext);
  if (!context) throw new Error("useViewMode yalnızca ViewModeProvider içinde kullanılabilir.");
  return context;
}
