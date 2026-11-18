import type { SystemSnapshot } from "./types";

export interface SnapshotState {
  snapshot: SystemSnapshot | null;
  error: string | null;
  lastUpdated: string | null;
}

const POLL_INTERVAL_MS = 10_000;
const SERVER_STATE: SnapshotState = { snapshot: null, error: null, lastUpdated: null };

let state: SnapshotState = SERVER_STATE;
const listeners = new Set<() => void>();
let timer: number | undefined;
let controller: AbortController | null = null;

function emit(next: SnapshotState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Gerçek sistem durumunu `/api/system/snapshot` uç noktasından okur. */
export async function refreshSnapshot(): Promise<void> {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  try {
    const response = await fetch("/api/system/snapshot", { cache: "no-store", signal: current.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as SystemSnapshot;
    emit({ snapshot: data, error: null, lastUpdated: data.generatedAt });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    emit({ ...state, error: `Sistem durumu okunamadı: ${(error as Error).message}` });
  }
}

function onFocus() {
  void refreshSnapshot();
}

/** İlk abone geldiğinde 10 saniyelik yoklamayı başlatır, son abone gidince durdurur. */
export function subscribeSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshSnapshot();
    timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSnapshot();
    }, POLL_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      controller?.abort();
    }
  };
}

export function getSnapshotState(): SnapshotState {
  return state;
}

export function getServerSnapshotState(): SnapshotState {
  return SERVER_STATE;
}
