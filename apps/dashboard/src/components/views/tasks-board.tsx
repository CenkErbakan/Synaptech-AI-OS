"use client";

import { useMemo, useState } from "react";

import {
  AGENT_IDS,
  BOARD_COLUMNS,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  USER_TASK_ACTION_LABELS,
  actorLabel,
  allowedUserActions,
  isTaskTimedOut,
  selectDemo,
  type AgentId,
  type NewTaskInput,
  type Priority,
  type Task,
  type UserTaskActionType,
} from "@synaptech/shared";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { PriorityBadge, TaskStatusBadge } from "@/components/common/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { demoApplyTaskAction, demoCreateTask } from "@/lib/demo/actions";
import { useDemoDataset } from "@/lib/demo/store";
import { useDemoOps } from "@/lib/demo/use-demo-ops";
import { formatDateTime, formatRelative } from "@/lib/format";

const PROJECTS = [
  { slug: "synaptech", name: "SynapTech" },
  { slug: "subify", name: "Subify" },
  { slug: "marivo", name: "Marivo" },
  { slug: "synaptech-ai-os", name: "SynapTech AI OS" },
];

export { TasksRealBoard as TasksRealEmpty } from "@/components/views/tasks-real";

export function TasksDemoBoard() {
  const { dataset, ready } = useDemoDataset();
  const { run, options, killSwitchEnabled, maxRetries } = useDemoOps();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const tasks = useMemo(
    () => (dataset ? selectDemo(dataset.tasks, "görev panosu") : []),
    [dataset],
  );
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const now = new Date();

  if (!ready || !dataset) return <EmptyState icon={ClipboardList} title="DEMO verisi yükleniyor…" />;

  function onAction(taskId: string, type: UserTaskActionType) {
    run((current) => demoApplyTaskAction(current, taskId, { type }, options()));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="DEMO Kanban" sources={["demo"]} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={showCancelled}
              onChange={(event) => setShowCancelled(event.target.checked)}
            />
            İptal edilenleri göster
          </label>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                DEMO görev oluştur
              </Button>
            </DialogTrigger>
            <CreateTaskDialog
              killSwitchEnabled={killSwitchEnabled}
              onSubmit={(input) => {
                const result = run((current) => demoCreateTask(current, input, options()));
                if (result.ok) setCreateOpen(false);
              }}
            />
          </Dialog>
        </div>
      </div>

      {killSwitchEnabled ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Kill switch açık: yeni görev, devam ettirme ve yeniden başlatma reddedilir.
        </p>
      ) : null}

      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex min-w-max gap-3 pb-3">
          {BOARD_COLUMNS.map((column) => {
            const columnTasks = tasks.filter((task) => task.status === column);
            return (
              <div key={column} className="w-72 shrink-0 rounded-xl border border-border/80 bg-muted/20">
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                  <p className="text-xs font-medium">{TASK_STATUS_LABELS[column]}</p>
                  <span className="text-[11px] text-muted-foreground">{columnTasks.length}</span>
                </div>
                <div className="space-y-2 p-2">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      now={now}
                      maxRetries={maxRetries}
                      killSwitchEnabled={killSwitchEnabled}
                      onOpen={() => setSelectedId(task.id)}
                      onAction={onAction}
                    />
                  ))}
                  {columnTasks.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">Boş</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {showCancelled ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">İptal edilenler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks
              .filter((task) => task.status === "cancelled")
              .map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left text-sm"
                  onClick={() => setSelectedId(task.id)}
                >
                  <span>{task.title}</span>
                  <TaskStatusBadge status="cancelled" />
                </button>
              ))}
          </CardContent>
        </Card>
      ) : null}

      <TaskDetailSheet
        task={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        now={now}
        maxRetries={maxRetries}
        killSwitchEnabled={killSwitchEnabled}
        onAction={onAction}
      />
    </div>
  );
}

function TaskCard({
  task,
  now,
  maxRetries,
  killSwitchEnabled,
  onOpen,
  onAction,
}: {
  task: Task;
  now: Date;
  maxRetries: number;
  killSwitchEnabled: boolean;
  onOpen: () => void;
  onAction: (taskId: string, type: UserTaskActionType) => void;
}) {
  const actions = allowedUserActions(task, { killSwitchEnabled, maxRetries }).slice(0, 2);
  return (
    <div className="rounded-lg border border-border/80 bg-card/80 p-3 text-left shadow-sm">
      <button type="button" className="w-full text-left" onClick={onOpen}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug whitespace-normal">{task.title}</p>
          <PriorityBadge priority={task.priority} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {task.projectSlug} · {task.assignee}
          {task.paused ? " · Durduruldu" : ""}
          {isTaskTimedOut(task, now) ? " · Zaman aşımı" : ""}
        </p>
      </button>
      <div className="mt-2 flex flex-wrap gap-1">
        {actions.map((action) => (
          <Button key={action} size="xs" variant="outline" onClick={() => onAction(task.id, action)}>
            {USER_TASK_ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function TaskDetailSheet({
  task,
  open,
  onOpenChange,
  now,
  maxRetries,
  killSwitchEnabled,
  onAction,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  now: Date;
  maxRetries: number;
  killSwitchEnabled: boolean;
  onAction: (taskId: string, type: UserTaskActionType) => void;
}) {
  if (!task) return null;
  const actions = allowedUserActions(task, { killSwitchEnabled, maxRetries });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{task.title}</SheetTitle>
          <SheetDescription>{task.id}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 px-1 text-sm">
          <div className="flex flex-wrap gap-2">
            <SourceBadge source={task.source} />
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
          <p className="text-muted-foreground">{task.description || "Açıklama yok."}</p>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Proje</dt>
              <dd>{task.projectSlug}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sorumlu</dt>
              <dd>{task.assignee}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Oluşturulma</dt>
              <dd>{formatDateTime(task.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Başlangıç</dt>
              <dd>{formatDateTime(task.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Bitiş</dt>
              <dd>{formatDateTime(task.finishedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Deneme</dt>
              <dd>
                {task.attempts}/{maxRetries}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{task.git?.branch ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">PR</dt>
              <dd>{task.git?.prUrl ?? "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Test</dt>
              <dd>{task.tests ? `${task.tests.status}: ${task.tests.summary}` : "—"}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action} size="sm" variant="outline" onClick={() => onAction(task.id, action)}>
                {USER_TASK_ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium">İşlem geçmişi</p>
            <ol className="space-y-2">
              {[...task.history].reverse().map((event) => (
                <li key={event.id} className="rounded-md border border-border/70 px-2 py-1.5 text-xs">
                  <p>{event.message}</p>
                  <p className="text-muted-foreground">
                    {actorLabel(event.actor)} · {formatRelative(event.at, now)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CreateTaskDialog({
  killSwitchEnabled,
  onSubmit,
}: {
  killSwitchEnabled: boolean;
  onSubmit: (input: NewTaskInput) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectSlug, setProjectSlug] = useState("synaptech");
  const [assignee, setAssignee] = useState<AgentId>("ceo");
  const [priority, setPriority] = useState<Priority>("medium");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>DEMO görev oluştur</DialogTitle>
        <DialogDescription>Bu kayıt yalnızca tarayıcıdaki DEMO deposuna yazılır.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-title">Başlık</Label>
          <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-desc">Açıklama</Label>
          <Textarea id="task-desc" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Proje</Label>
            <Select value={projectSlug} onValueChange={setProjectSlug}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECTS.map((project) => (
                  <SelectItem key={project.slug} value={project.slug}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Sorumlu</Label>
            <Select value={assignee} onValueChange={(value) => setAssignee(value as AgentId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
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
      <DialogFooter>
        <Button
          disabled={killSwitchEnabled}
          onClick={() => {
            if (killSwitchEnabled) {
              toast.error("Kill switch açık: yeni görev oluşturulamaz.");
              return;
            }
            onSubmit({ title, description, projectSlug, assignee, priority, initialStatus: "backlog" });
          }}
        >
          Oluştur
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
