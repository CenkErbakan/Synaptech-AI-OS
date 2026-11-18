"use client";

import { toast } from "sonner";

import { useSnapshot } from "@/components/providers/snapshot-provider";

import { newDemoId, useDemoStore } from "./store";
import type { DemoResult } from "./actions";

const DEFAULT_MAX_RETRIES = 2;

export function useDemoOps() {
  const { snapshot } = useSnapshot();
  const killSwitchEnabled = snapshot?.killSwitch.ok === true ? snapshot.killSwitch.data.enabled : false;
  const maxRetries = DEFAULT_MAX_RETRIES;

  function run(operation: Parameters<ReturnType<typeof useDemoStore.getState>["apply"]>[0]): DemoResult {
    const result = useDemoStore.getState().apply(operation);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
    return result;
  }

  function options() {
    return {
      now: new Date(),
      killSwitchEnabled,
      maxRetries,
      newId: newDemoId,
    };
  }

  return { run, options, killSwitchEnabled, maxRetries };
}
