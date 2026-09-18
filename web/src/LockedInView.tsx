import { useEffect, useMemo, useState } from "react";
import { parseUTC, type Active, type Task } from "./api";
import { formatClock } from "./format";

// The locked-in takeover: while on, this replaces the tab shell entirely (see
// AppBody) — no nav to other tabs or tasks, just the one thing you're doing.
// Not tracking is a real state here, not just a transition, so it gets its
// own screen (a quick task picker) rather than stranding you with nothing to
// click once you've turned the mode on ahead of picking a task.

export default function LockedInView({
  tasks,
  active,
  onStart,
  onStop,
  onExit,
  error,
}: {
  tasks: Task[];
  active: Active | null;
  onStart: (id: number) => void;
  onStop: () => void;
  onExit: () => void;
  error?: string | null;
}) {
  const runningTask = useMemo(
    () => (active ? (tasks.find((t) => t.id === active.task_id) ?? null) : null),
    [tasks, active],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
      <button
        onClick={onExit}
        title="Exit locked-in mode"
        className="absolute top-4 right-4 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-900 hover:text-slate-100"
      >
        🔓 Exit
      </button>

      {error && (
        <div className="absolute top-4 left-4 rounded-lg bg-red-950 px-3 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-6">
        {active && runningTask ? (
          <Tracking task={runningTask} startedAt={active.started_at} onStop={onStop} />
        ) : (
          <Picker tasks={tasks} onStart={onStart} />
        )}
      </div>
    </div>
  );
}

function Tracking({
  task,
  startedAt,
  onStop,
}: {
  task: Task;
  startedAt: string;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = (now - parseUTC(startedAt).getTime()) / 1000;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <span className="text-sm font-medium tracking-wide text-indigo-400 uppercase">
        Locked in
      </span>
      <h1 className="max-w-2xl text-3xl font-semibold text-white">{task.title}</h1>
      <div className="font-mono text-6xl tabular-nums text-slate-200">{formatClock(secs)}</div>
      <button
        onClick={onStop}
        className="rounded-lg bg-red-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-red-400"
      >
        ⏹ Stop
      </button>
    </div>
  );
}

function Picker({ tasks, onStart }: { tasks: Task[]; onStart: (id: number) => void }) {
  const [q, setQ] = useState("");
  const candidates = tasks.filter((t) => t.status !== "done" && !t.archived);
  const filtered = q.trim()
    ? candidates.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase()))
    : candidates;

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="text-center">
        <span className="text-sm font-medium tracking-wide text-indigo-400 uppercase">
          Locked in
        </span>
        <p className="mt-1 text-slate-400">Not tracking anything — pick a task to start.</p>
      </div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter tasks…"
        className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500"
      />
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {filtered.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => onStart(t.id)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left text-sm text-slate-200 hover:border-indigo-500 hover:bg-slate-800"
            >
              {t.title}
              <span className="text-indigo-400">▶</span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-slate-500">
            {candidates.length === 0 ? "No open tasks — add one in Tasks first." : "No matches."}
          </li>
        )}
      </ul>
    </div>
  );
}
