"use client";

import { useSyncExternalStore } from "react";

import {
  getServerSnapshotState,
  getSnapshotState,
  refreshSnapshot,
  subscribeSnapshot,
  type SnapshotState,
} from "@/lib/snapshot-store";

export function useSnapshot(): SnapshotState & { refresh: () => void } {
  const state = useSyncExternalStore(subscribeSnapshot, getSnapshotState, getServerSnapshotState);
  return { ...state, refresh: () => void refreshSnapshot() };
}

export function useKillSwitchEnabled(): boolean {
  const { snapshot } = useSnapshot();
  return snapshot?.killSwitch.ok ? snapshot.killSwitch.data.enabled : false;
}
