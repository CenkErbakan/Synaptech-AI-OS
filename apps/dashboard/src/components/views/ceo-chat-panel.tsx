"use client";

import { useCallback, useEffect, useState } from "react";

import { Bot, Send } from "lucide-react";
import { toast } from "sonner";

import { SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ChatContext {
  llmIntegrated: boolean;
  chatMode: string;
  disclaimer: string;
  goals: Array<{ goalKey: string; title: string; projectSlug: string }>;
  opportunities: Array<{ id: string; title: string; status: string }>;
  openTasks: Array<{ id: string; title: string; status: string }>;
  chains: Array<{ chainId: string | null; title: string; status: string }>;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  meta?: string;
}

async function controlFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api/control/${path}`, { ...init, headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `İstek başarısız (${res.status})`);
  return json as T;
}

export function CeoChatPanel() {
  const [ctx, setCtx] = useState<ChatContext | null>(null);
  const [input, setInput] = useState("zincirler");
  const [turns, setTurns] = useState<Turn[]>([]);

  const load = useCallback(async () => {
    try {
      const c = await controlFetch<ChatContext>("coordination/ceo-chat/context");
      setCtx(c);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CEO bağlamı alınamadı");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const message = input.trim();
    if (!message) return;
    setTurns((t) => [...t, { role: "user", text: message }]);
    setInput("");
    try {
      const res = await controlFetch<{
        reply: string;
        llmIntegrated: boolean;
        chatMode: string;
        usedFacts: string[];
      }>("coordination/ceo-chat/message", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: res.reply,
          meta: `llmIntegrated=${String(res.llmIntegrated)} · mode=${res.chatMode} · facts=${res.usedFacts.length}`,
        },
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Yanıt alınamadı");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <SectionTitle
            title="AI CEO Chat"
            description="MSSQL bağlamı. MODEL_PROVIDER=local ise Ollama; aksi halde deterministik/mock."
            sources={["api"]}
          />
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <SourceBadge source="api" />
            <span
              className={
                ctx?.chatMode === "local_llm"
                  ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:text-emerald-200"
                  : "rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-200"
              }
            >
              {ctx?.chatMode === "local_llm"
                ? "Yerel LLM (Ollama)"
                : `Kanal: ${ctx?.chatMode ?? "deterministic"} — gerçek AI sohbeti değil`}
            </span>
          </div>
          {ctx ? (
            <>
              <p className="text-muted-foreground">{ctx.disclaimer}</p>
              <p>
                Bağlam: {ctx.goals.length} hedef · {ctx.opportunities.length} fırsat · {ctx.openTasks.length} açık
                görev · {ctx.chains.length} zincir
              </p>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const goalKey = String(fd.get("goalKey") ?? "");
                  const currentValue = String(fd.get("currentValue") ?? "");
                  void controlFetch("coordination/ceo-chat/goals", {
                    method: "PATCH",
                    body: JSON.stringify({ goalKey, currentValue }),
                  })
                    .then(() => {
                      toast.success("Hedef güncellendi");
                      void load();
                    })
                    .catch((err) => toast.error(err instanceof Error ? err.message : "Hedef yazılamadı"));
                }}
              >
                <select name="goalKey" className="rounded border bg-background px-2 py-1 text-xs" required>
                  {ctx.goals.map((g) => (
                    <option key={g.goalKey} value={g.goalKey}>
                      {g.projectSlug}: {g.title}
                    </option>
                  ))}
                </select>
                <Input name="currentValue" placeholder="KPI güncel değer" className="h-8 max-w-xs text-xs" />
                <Button type="submit" size="sm" variant="outline">
                  Hedefi kaydet
                </Button>
              </form>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Sohbet" description="Yanıtlar MSSQL gerçek verisinden üretilir." sources={["api"]} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-md border p-3 text-sm">
            {turns.length === 0 ? (
              <p className="text-muted-foreground">
                Örnek: &quot;hedefler&quot;, &quot;fırsatlar&quot;, &quot;zincirler&quot;, &quot;mesajlar&quot;
              </p>
            ) : (
              turns.map((t, i) => (
                <div key={`${t.role}-${i}`} className={t.role === "user" ? "text-right" : ""}>
                  <div
                    className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-md px-3 py-2 ${
                      t.role === "user" ? "bg-primary/15" : "bg-muted"
                    }`}
                  >
                    {t.role === "assistant" ? (
                      <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Bot className="size-3.5" /> Deterministik CEO
                      </p>
                    ) : null}
                    {t.text}
                    {t.meta ? <p className="mt-1 text-xs text-muted-foreground">{t.meta}</p> : null}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Soru yazın…"
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <Button type="button" onClick={() => void send()}>
              <Send className="mr-1 size-3.5" />
              Gönder
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
