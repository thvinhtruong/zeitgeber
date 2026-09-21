import { useEffect, useMemo, useRef, useState } from "react";
import { api, parseUTC, type Active, type Task } from "./api";
import { formatClock, formatDuration, formatMinutes, localDayKey } from "./format";
import { useTracking } from "./tracking";
import { NotePanel, NotePreview, NoteToggle } from "./Notes";
import EditableDuration from "./EditableDuration";

// A day plan is the set of tasks whose `planned_for` equals the day key, plus
// recurring tasks that auto-appear (daily → every day, weekly → the weekday the
// task was created on). Recurring tasks are never written to `planned_for`.
function autoAppears(task: Task, day: Date): boolean {
  if (task.status !== "recurring") return false;
  if (task.recurrence === "weekly") return parseUTC(task.created_at).getDay() === day.getDay();
  return true; // 'daily' (and 'none', which the UI treats as daily)
}

// "2026-07-30" -> local midnight Date
const dayDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const shiftDay = (key: string, days: number) => {
  const d = dayDate(key);
  d.setDate(d.getDate() + days);
  return localDayKey(d);
};

export default function TodayView() {
  const todayKey = localDayKey(new Date());
  const [day, setDay] = useState(todayKey);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  // tracked seconds per task for `day`, from /api/report (clipped to the day)
  const [tracked, setTracked] = useState<Record<number, number>>({});
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // the header pill mirrors this view's data; `version` bumps when the header
  // changes something (e.g. idle auto-stop) and this view must re-read
  const { publish, version } = useTracking();

  // 1s tick drives the live timer display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function refresh() {
    try {
      const from = dayDate(day);
      const to = dayDate(shiftDay(day, 1));
      const [{ tasks, active }, { entries }] = await Promise.all([
        api.tasks(),
        api.report(from, to),
      ]);
      const sums: Record<number, number> = {};
      for (const e of entries) {
        const secs =
          (parseUTC(e.ended_at).getTime() - parseUTC(e.started_at).getTime()) / 1000;
        sums[e.task_id] = (sums[e.task_id] ?? 0) + Math.max(0, secs);
      }
      setTasks(tasks);
      setActive(active);
      publish(tasks, active);
      setTracked(sums);
      setFetchedAt(Date.now());
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, [day, version]);

  const act = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const { planned, backlog } = useMemo(() => {
    const d = dayDate(day);
    const planned = tasks.filter((t) => t.planned_for === day || autoAppears(t, d));
    const plannedIds = new Set(planned.map((t) => t.id));
    const backlog = tasks.filter((t) => !plannedIds.has(t.id) && t.status !== "done");
    return { planned, backlog };
  }, [tasks, day]);

  // the report already counts a running entry up to fetch time — top up the
  // difference so the number keeps climbing between refreshes
  const trackedSeconds = (taskId: number) => {
    const base = tracked[taskId] ?? 0;
    if (active?.task_id !== taskId) return base;
    return base + Math.max(0, (now - fetchedAt) / 1000);
  };

  const plannedMinutes = planned.reduce((s, t) => s + t.duration_minutes, 0);
  const trackedTotal = Object.keys(tracked).reduce(
    (s, id) => s + trackedSeconds(Number(id)),
    0,
  );
  const doneCount = planned.filter((t) => t.status === "done").length;

  const dayLabel = dayDate(day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const relative =
    day === todayKey
      ? "Today"
      : day === shiftDay(todayKey, 1)
        ? "Tomorrow"
        : day === shiftDay(todayKey, -1)
          ? "Yesterday"
          : null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await api.create(title, day);
    titleRef.current?.focus();
    refresh();
  }

  return (
    <div className="space-y-4">
      {/* ---- day header ---- */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDay(shiftDay(day, -1))}
            title="Previous day"
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            ◀
          </button>
          <div className="min-w-[9rem] text-center">
            <div className="text-sm font-semibold">{dayLabel}</div>
            {relative && (
              <div className="text-[10px] uppercase tracking-wide text-indigo-500">
                {relative}
              </div>
            )}
          </div>
          <button
            onClick={() => setDay(shiftDay(day, 1))}
            title="Next day"
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            ▶
          </button>
        </div>

        <input
          type="date"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
        {day !== todayKey && (
          <button
            onClick={() => setDay(todayKey)}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Jump to today
          </button>
        )}

        <div className="ml-auto flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>
            Planned{" "}
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
              {formatMinutes(plannedMinutes)}
            </span>
          </span>
          <span>
            Tracked{" "}
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
              {formatDuration(trackedTotal)}
            </span>
          </span>
          <span>
            Done{" "}
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {doneCount}/{planned.length}
            </span>
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ---- plan for the day ---- */}
      <form onSubmit={add} className="flex gap-2">
        <input
          ref={titleRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={`Add a task for ${relative?.toLowerCase() ?? dayLabel}…`}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Add
        </button>
      </form>

      <ul className="space-y-2">
        {planned.map((t) => {
          const running = active?.task_id === t.id;
          const auto = autoAppears(t, dayDate(day));
          const secs = trackedSeconds(t.id);
          const over = secs > t.duration_minutes * 60 && t.duration_minutes > 0;
          return (
            <li
              key={t.id}
              className={`rounded-xl border px-4 py-3 ${
                running
                  ? "border-amber-300 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-900/10"
                  : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              }`}
            >
              <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={t.status === "done"}
                title="Mark done"
                onChange={(e) =>
                  act(() =>
                    api.update(t.id, {
                      status: e.target.checked ? "done" : auto ? "recurring" : "todo",
                    }),
                  )()
                }
                className="h-4 w-4 shrink-0 accent-emerald-600"
              />

              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm ${
                    t.status === "done" ? "text-slate-400 line-through" : ""
                  }`}
                >
                  {t.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                  {auto && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {t.recurrence === "weekly" ? "weekly" : "daily"}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span>plan</span>
                    <EditableDuration
                      task={t}
                      onSaved={refresh}
                      onError={setError}
                    />
                  </span>
                  <NoteToggle
                    task={t}
                    open={notesOpen === t.id}
                    onClick={() => setNotesOpen(notesOpen === t.id ? null : t.id)}
                  />
                  {notesOpen !== t.id && (
                    <NotePreview task={t} className="min-w-0 text-slate-400" />
                  )}
                </div>
              </div>

              <span
                className={`w-20 shrink-0 text-right font-mono text-sm tabular-nums ${
                  running
                    ? "text-amber-600 dark:text-amber-400"
                    : over
                      ? "text-red-500"
                      : "text-slate-500"
                }`}
              >
                {running ? formatClock(secs) : secs > 0 ? formatDuration(secs) : "—"}
              </span>

              {running ? (
                <button
                  onClick={act(() => api.stop())}
                  className="shrink-0 rounded-md bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-400"
                >
                  ⏹ Stop
                </button>
              ) : (
                <button
                  onClick={act(() => api.start(t.id))}
                  className="shrink-0 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  ▶ Start
                </button>
              )}

              <button
                onClick={act(() => api.update(t.id, { planned_for: null }))}
                disabled={auto}
                title={
                  auto
                    ? "Recurring tasks appear on every matching day — change the status in Tasks to remove it"
                    : "Remove from this day"
                }
                className="shrink-0 text-slate-400 enabled:hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ✕
              </button>
              </div>

              {notesOpen === t.id && (
                <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                  <NotePanel task={t} onSaved={refresh} onError={setError} />
                </div>
              )}
            </li>
          );
        })}
        {planned.length === 0 && (
          <li className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
            Nothing planned for this day — add a task above or pick one from the backlog.
          </li>
        )}
      </ul>

      {/* ---- backlog picker ---- */}
      {backlog.length > 0 && (
        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Add from backlog
          </h2>
          <div className="flex flex-wrap gap-2">
            {backlog.map((t) => (
              <button
                key={t.id}
                onClick={act(() => api.update(t.id, { planned_for: day }))}
                title={
                  t.planned_for ? `Currently planned for ${t.planned_for}` : "Add to this day"
                }
                className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
              >
                <span className="text-slate-400">+</span>
                <span className="max-w-[16rem] truncate">{t.title}</span>
                <span className="font-mono text-[10px] text-slate-400">
                  {formatMinutes(t.duration_minutes)}
                </span>
                {t.planned_for && (
                  <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800">
                    {t.planned_for.slice(5)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
