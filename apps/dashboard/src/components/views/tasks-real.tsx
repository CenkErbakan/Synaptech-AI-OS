"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BOARD_COLUMNS,
  DISPATCH_STATE_LABELS,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  USER_TASK_ACTION_LABELS,
  allowedUserActions,
  type Priority,
  type Task,
  type UserTaskActionType,
} from "@synaptech/shared";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { PriorityBadge, TaskStatusBadge } from "@/components/common/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

type ProjectOption = { slug: string; name: string };

const FALLBACK_PROJECTS: ProjectOption[] = [
  { slug: "synaptech", name: "SynapTech" },
  { slug: "subify", name: "Subify" },
  { slug: "marivo", name: "Marivo" },
  { slug: "synaptech-ai-os", name: "SynapTech AI OS" },
];

async function controlFetch<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (init?.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const res = await fetch(`/api/control/${path}`, { ...init, headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `İstek başarısız (${res.status})`);
  }
  return json as T;
}

export function TasksRealBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [epoch, setEpoch] = useState<"current" | "legacy" | "all">("current");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (showArchived) params.set("archived", "1");
      params.set("epoch", epoch);
      const data = await controlFetch<{ tasks: Task[] }>(`tasks?${params.toString()}`);
      setTasks(data.tasks.filter((task) => task.source !== "demo"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Görevler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [showArchived, epoch]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const columns = useMemo(() => {
    const visible = showCancelled ? tasks : tasks.filter((task) => task.status !== "cancelled");
    return BOARD_COLUMNS.map((status) => ({
      status,
      items: visible.filter((task) => task.status === status),
    }));
  }, [tasks, showCancelled]);

  async function onAction(taskId: string, type: UserTaskActionType) {
    const path =
      type === "cancel"
        ? `tasks/${taskId}/cancel`
        : type === "pause"
          ? `tasks/${taskId}/pause`
          : type === "resume"
            ? `tasks/${taskId}/resume`
            : type === "restart"
              ? `tasks/${taskId}/retry`
              : null;
    if (!path) {
      toast.message("Bu geçiş API üzerinden henüz desteklenmiyor.");
      return;
    }
    try {
      await controlFetch(path, { method: "POST", body: "{}" });
      toast.success(USER_TASK_ACTION_LABELS[type]);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <SectionTitle title="CEO'ya görev gönder" sources={["api"]} />
        </CardHeader>
        <CardContent>
          <CeoTaskForm
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={async () => {
              setCreateOpen(false);
              await reload();
            }}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title={showArchived ? "Arşivlenmiş görevler" : "Gerçek Kanban"}
          sources={["api"]}
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Arşivi göster
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Dönem
            <select
              className="rounded border bg-background px-1 py-0.5"
              value={epoch}
              onChange={(event) => setEpoch(event.target.value as "current" | "legacy" | "all")}
            >
              <option value="current">aktif dönem</option>
              <option value="legacy">eski kuyruk</option>
              <option value="all">hepsi</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={showCancelled}
              onChange={(event) => setShowCancelled(event.target.checked)}
            />
            İptal edilenleri göster
          </label>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            <RefreshCw className="size-4" />
            Yenile
          </Button>
        </div>
      </div>

      {loading && tasks.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Görevler yükleniyor…" />
      ) : null}
      {error ? (
        <EmptyState
          icon={ClipboardList}
          title="API bağlantısı yok"
          description={error}
        />
      ) : null}
      {!loading && !error && tasks.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Henüz gerçek görev yok"
          description="CEO formu ile ilk görevi oluşturun. Kayıt MSSQL'de tutulur."
        />
      ) : null}

      {tasks.length > 0 ? (
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-3 pb-3">
            {columns.map((column) => (
              <div key={column.status} className="w-72 shrink-0 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {TASK_STATUS_LABELS[column.status]} ({column.items.length})
                </p>
                {column.items.map((task) => (
                  <Card key={task.id} className="whitespace-normal">
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{task.title}</p>
                        <SourceBadge source="api" />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <PriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {task.projectSlug} · {task.assignee}
                      </p>
                      <p className="text-xs text-amber-200/90">
                        {DISPATCH_STATE_LABELS[task.dispatchState ?? "not_applicable"]}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(task.updatedAt)}</p>
                      <div className="flex flex-wrap gap-1">
                        {allowedUserActions(task, { killSwitchEnabled: false, maxRetries: 2 }).map((action) => (
                          <Button key={action} size="sm" variant="outline" onClick={() => void onAction(task.id, action)}>
                            {USER_TASK_ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      ) : null}
    </div>
  );
}

function CeoTaskForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [projectSlug, setProjectSlug] = useState("synaptech-ai-os");
  const [projects, setProjects] = useState<ProjectOption[]>(FALLBACK_PROJECTS);
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueAt, setDueAt] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await controlFetch<{ projects: ProjectOption[] }>("projects");
        if (!cancelled && data.projects?.length) {
          setProjects(data.projects.map((p) => ({ slug: p.slug, name: p.name })));
        }
      } catch {
        /* fallback sabit liste */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setPending(true);
    try {
      await controlFetch("tasks/ceo", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({
          title,
          description,
          notes: notes || undefined,
          projectSlug,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        }),
      });
      toast.success("CEO görevi kaydedildi (Cloud yürütme onayı bekleniyor).");
      setTitle("");
      setDescription("");
      setNotes("");
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gönderilemedi");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          CEO&apos;ya görev gönder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>CEO&apos;ya görev gönder</DialogTitle>
          <DialogDescription>
            Görev MSSQL&apos;e yazılır ve AI CEO&apos;ya planlanır. Cloud Agent yalnızca Owner onayı + execute ile (varsayılan mock) başlar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ceo-title">Başlık</Label>
            <Input id="ceo-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ceo-desc">Açıklama</Label>
            <Textarea id="ceo-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ceo-notes">Ek notlar</Label>
            <Textarea id="ceo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Proje</Label>
              <Select value={projectSlug} onValueChange={setProjectSlug}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.slug} value={project.slug}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Öncelik</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as Priority[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {PRIORITY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ceo-due">Hedef tarih (isteğe bağlı)</Label>
            <Input id="ceo-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending || title.trim().length < 3} onClick={() => void submit()}>
            {pending ? "Gönderiliyor…" : "Gönder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
