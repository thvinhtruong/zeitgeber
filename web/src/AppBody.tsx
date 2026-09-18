import { useCallback, useMemo, useState } from "react";
import TasksView from "./TasksView";
import TodayView from "./TodayView";
import ReportsView from "./ReportsView";
import TrackingStatus from "./TrackingStatus";
import LockedInView from "./LockedInView";
import { api } from "./api";
import { useTracking } from "./tracking";
import { useLockedIn } from "./useLockedIn";
import { useIdleAutoStop } from "./useIdleAutoStop";

type Tab = "today" | "tasks" | "reports";

// Owns the two session-flag hooks (see useLockedIn / useIdleAutoStop) so they
// keep running regardless of which shell is on screen: the normal tab shell,
// or LockedInView's full-screen takeover, which replaces it entirely — no tab
// nav, no header — while locked-in mode is on.
export default function AppBody() {
  const [tab, setTab] = useState<Tab>("today");
  const { tasks, active, invalidate } = useTracking();
  const [error, setError] = useState<string | null>(null);

  const runningTask = useMemo(
    () => (active ? (tasks.find((t) => t.id === active.task_id) ?? null) : null),
    [tasks, active],
  );

  const stopTimer = useCallback(async () => {
    try {
      await api.stop();
      invalidate();
    } catch (e: any) {
      setError(e.message);
    }
  }, [invalidate]);

  const startTask = useCallback(
    async (id: number) => {
      try {
        await api.start(id);
        invalidate();
      } catch (e: any) {
        setError(e.message);
      }
    },
    [invalidate],
  );

  const lockedIn = useLockedIn({
    active,
    runningLabel: runningTask?.title,
    onStopTimer: stopTimer,
  });
  const idle = useIdleAutoStop({ active, onStopped: invalidate, onError: setError });

  if (lockedIn.on) {
    return (
      <LockedInView
        tasks={tasks}
        active={active}
        onStart={startTask}
        onStop={stopTimer}
        onExit={() => lockedIn.toggle(false)}
        error={error}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <span className="text-xl">🌅</span> Zeitgeber
          </h1>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <TrackingStatus lockedIn={lockedIn} idle={idle} error={error} />
            <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(["today", "tasks", "reports"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                    tab === t
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
        {tab === "today" ? <TodayView /> : tab === "tasks" ? <TasksView /> : <ReportsView />}
      </main>
    </div>
  );
}
