import { describe, expect, it } from "vitest";

import {
  TaskTransitionError,
  allowedUserActions,
  applyTaskAction,
  createTask,
  isTaskTimedOut,
} from "../src/domain/task-machine";
import { makeContext, makeTask, NOW } from "./helpers";

function expectTaskError(fn: () => unknown, code: TaskTransitionError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskTransitionError);
    expect((error as TaskTransitionError).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

describe("createTask", () => {
  it("geçerli girdiyle görevi ve 'created' olayını oluşturur", () => {
    const task = createTask(
      { title: "Yeni görev", projectSlug: "subify", assignee: "cto" },
      { ...makeContext(), source: "demo" },
    );
    expect(task.status).toBe("backlog");
    expect(task.source).toBe("demo");
    expect(task.history).toHaveLength(1);
    expect(task.history[0]?.type).toBe("created");
  });

  it("kill switch açıkken yeni görevi reddeder", () => {
    expectTaskError(
      () =>
        createTask(
          { title: "Yeni görev", projectSlug: "subify", assignee: "cto" },
          { ...makeContext({ killSwitchEnabled: true }), source: "demo" },
        ),
      "kill_switch",
    );
  });

  it("görev oluşturma yetkisi olmayan ajanı reddeder", () => {
    expectTaskError(
      () =>
        createTask(
          { title: "Yeni görev", projectSlug: "subify", assignee: "cto" },
          { ...makeContext({ actor: { kind: "agent", agentId: "ads-manager" } }), source: "demo" },
        ),
      "forbidden_actor",
    );
  });

  it("geçersiz başlığı doğrulama hatasıyla reddeder", () => {
    expectTaskError(
      () =>
        createTask(
          { title: "x", projectSlug: "subify", assignee: "cto" },
          { ...makeContext(), source: "demo" },
        ),
      "validation",
    );
  });
});

describe("kullanıcı eylemleri", () => {
  it("kullanıcı görevi doğrudan 'Çalışıyor' durumuna alamaz", () => {
    const task = makeTask();
    expectTaskError(() => applyTaskAction(task, { type: "advance", to: "in_progress" }, makeContext()), "forbidden_actor");
  });

  it("durdurma ve devam ettirme duraklatma bayrağını değiştirir", () => {
    const running = makeTask({ status: "in_progress" });
    const paused = applyTaskAction(running, { type: "pause", reason: "test" }, makeContext());
    expect(paused.paused).toBe(true);
    expect(paused.status).toBe("in_progress");
    const resumed = applyTaskAction(paused, { type: "resume" }, makeContext());
    expect(resumed.paused).toBe(false);
  });

  it("kill switch açıkken durdurma ve iptal serbest, devam ettirme yasaktır", () => {
    const ctx = makeContext({ killSwitchEnabled: true });
    const running = makeTask({ status: "in_progress" });
    const paused = applyTaskAction(running, { type: "pause" }, ctx);
    expectTaskError(() => applyTaskAction(paused, { type: "resume" }, ctx), "kill_switch");
    const cancelled = applyTaskAction(paused, { type: "cancel" }, ctx);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.paused).toBe(false);
  });

  it("yeniden başlatma deneme sınırını uygular", () => {
    const failed = makeTask({ status: "failed", attempts: 1 });
    const restarted = applyTaskAction(failed, { type: "restart" }, makeContext());
    expect(restarted.status).toBe("planned");
    expect(restarted.attempts).toBe(2);
    const failedAgain = { ...restarted, status: "failed" as const };
    expectTaskError(() => applyTaskAction(failedAgain, { type: "restart" }, makeContext()), "retry_limit");
  });

  it("kill switch açıkken yeniden başlatmayı reddeder", () => {
    const failed = makeTask({ status: "failed" });
    expectTaskError(
      () => applyTaskAction(failed, { type: "restart" }, makeContext({ killSwitchEnabled: true })),
      "kill_switch",
    );
  });

  it("izin verilen kullanıcı eylemlerini duruma göre listeler", () => {
    expect(allowedUserActions(makeTask({ status: "backlog" }), { killSwitchEnabled: false, maxRetries: 2 })).toEqual([
      "plan",
      "cancel",
    ]);
    expect(
      allowedUserActions(makeTask({ status: "in_progress", paused: true }), { killSwitchEnabled: true, maxRetries: 2 }),
    ).toEqual(["cancel"]);
    expect(
      allowedUserActions(makeTask({ status: "failed", attempts: 2 }), { killSwitchEnabled: false, maxRetries: 2 }),
    ).toEqual(["cancel"]);
    expect(allowedUserActions(makeTask({ status: "done" }), { killSwitchEnabled: false, maxRetries: 2 })).toEqual([]);
  });
});

describe("ajan ve sistem geçişleri", () => {
  const developer = { kind: "agent", agentId: "developer" } as const;

  it("sorumlu ajan görevi izinli geçişlerle ilerletir ve zaman damgalarını yazar", () => {
    const planned = makeTask({ assignee: "developer" });
    const running = applyTaskAction(planned, { type: "advance", to: "in_progress" }, makeContext({ actor: developer }));
    expect(running.startedAt).toBe(NOW.toISOString());
    const review = applyTaskAction(running, { type: "advance", to: "in_review" }, makeContext({ actor: developer }));
    expect(review.status).toBe("in_review");
    expect(review.history.at(-1)?.type).toBe("status_changed");
  });

  it("başka ajanın görevini ilerletmeyi reddeder", () => {
    const planned = makeTask({ assignee: "developer" });
    expectTaskError(
      () =>
        applyTaskAction(planned, { type: "advance", to: "in_progress" }, makeContext({ actor: { kind: "agent", agentId: "tester" } })),
      "forbidden_actor",
    );
  });

  it("ajan onay bekleyen görevi tamamlayamaz; yalnızca sistem (yürütücü) tamamlar", () => {
    const awaiting = makeTask({ assignee: "developer", status: "awaiting_approval" });
    expectTaskError(
      () => applyTaskAction(awaiting, { type: "advance", to: "done" }, makeContext({ actor: developer })),
      "invalid_transition",
    );
    const done = applyTaskAction(awaiting, { type: "advance", to: "done" }, makeContext({ actor: { kind: "system" } }));
    expect(done.status).toBe("done");
    expect(done.finishedAt).toBe(NOW.toISOString());
  });

  it("durdurulmuş görev ilerletilemez", () => {
    const paused = makeTask({ assignee: "developer", status: "in_progress", paused: true });
    expectTaskError(
      () => applyTaskAction(paused, { type: "advance", to: "testing" }, makeContext({ actor: developer })),
      "paused",
    );
  });

  it("kill switch açıkken görev çalıştırılamaz", () => {
    const planned = makeTask({ assignee: "developer" });
    expectTaskError(
      () =>
        applyTaskAction(planned, { type: "advance", to: "in_progress" }, makeContext({ actor: developer, killSwitchEnabled: true })),
      "kill_switch",
    );
  });
});

describe("isTaskTimedOut", () => {
  it("zaman aşımını yalnızca çalışan ve durdurulmamış görevlerde bildirir", () => {
    const startedAt = new Date(NOW.getTime() - 61 * 60_000).toISOString();
    expect(isTaskTimedOut(makeTask({ status: "in_progress", startedAt, timeoutMinutes: 60 }), NOW)).toBe(true);
    expect(isTaskTimedOut(makeTask({ status: "in_progress", startedAt, timeoutMinutes: 60, paused: true }), NOW)).toBe(false);
    expect(isTaskTimedOut(makeTask({ status: "done", startedAt, timeoutMinutes: 60 }), NOW)).toBe(false);
  });
});
