"use client";

import { FlaskConical, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useViewMode } from "@/components/providers/view-mode-provider";
import { Button } from "@/components/ui/button";
import { useDemoStore } from "@/lib/demo/store";

/** DEMO modunda tüm içeriği amber çerçeve, filigran ve uyarı bandıyla sarar. */
export function DemoFrame({ children }: { children: React.ReactNode }) {
  const { mode, setMode } = useViewMode();
  if (mode !== "demo") return <>{children}</>;

  const reset = () => {
    useDemoStore.getState().reset(new Date());
    toast.success("DEMO verileri ilk hâline döndürüldü.");
  };

  return (
    <div className="demo-watermark relative rounded-2xl p-3 ring-2 ring-demo/60 sm:p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none overflow-hidden rounded-2xl"
      >
        {["top-24 left-6", "top-1/2 right-10", "bottom-16 left-1/3"].map((position) => (
          <span
            key={position}
            className={`absolute ${position} -rotate-12 font-heading text-7xl font-black tracking-[0.3em] text-demo/[0.06] sm:text-8xl`}
          >
            DEMO
          </span>
        ))}
      </div>

      <div
        role="status"
        className="relative mb-6 flex flex-col gap-3 rounded-xl border border-demo/50 bg-demo/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-md bg-demo px-2 py-0.5 text-xs font-bold tracking-wide text-demo-foreground">
            DEMO
          </span>
          <p className="text-demo">
            <span className="font-semibold">DEMO MODU.</span> Bu ekrandaki görev, onay, aktivite ve büyüme kayıtları
            örnektir; gerçek ajan verisi değildir ve tarayıcıda tutulur. Gerçek kayıtlar yalnızca Gerçek modda görünür.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw /> Demo verilerini sıfırla
          </Button>
          <Button size="sm" onClick={() => setMode("real")}>
            <FlaskConical /> Gerçek moda dön
          </Button>
        </div>
      </div>

      <div className="relative">{children}</div>
    </div>
  );
}
