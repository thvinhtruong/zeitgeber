import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { parseUTC, type Task } from "./api";
import { formatDuration, formatMinutes, localDayKey } from "./format";

// "What got done" for one local day, shared by Today and Tasks: stat tiles, a
// 14-day completed-per-day chart, and one block per task finished that day.
// "Done on a day" = the local day of `completed_at` (UTC, stamped by the server).

const WINDOW = 14;
const BAR = "#2a78d6"; // categorical slot 1, same blue as ReportsView

const dayDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shift = (key: string, days: number) => {
  const d = dayDate(key);
  d.setDate(d.getDate() + days);
  return localDayKey(d);
};
const doneDay = (t: Task) =>
  t.status === "done" && t.completed_at ? localDayKey(parseUTC(t.completed_at)) : null;

export default function DoneBoard({
  tasks,
  day,
  planned,
  title = "Done",
  onSelectDay,
}: {
  tasks: Task[];
  day: string; // local day key
  planned?: Task[]; // the day's plan, enables the completion-rate tile
  title?: string;
  onSelectDay?: (day: string) => void;
}) {
  const { doneToday, series, streak, windowTotal } = useMemo(() => {
    const perDay: Record<string, number> = {};
    for (const t of tasks) {
      const k = doneDay(t);
      if (k) perDay[k] = (perDay[k] ?? 0) + 1;
    }
    const doneToday = tasks
      .filter((t) => doneDay(t) === day)
      .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    const series = Array.from({ length: WINDOW }, (_, i) => {
      const key = shift(day, i - (WINDOW - 1));
      const d = dayDate(key);
      return {
        key,
        label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        long: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        done: perDay[key] ?? 0,
      };
    });
    // consecutive days with ≥1 done, ending on `day` (or the day before, if
    // nothing is done yet on `day` — the streak isn't broken until it's over)
    let streak = 0;
    let k = perDay[day] ? day : shift(day, -1);
    while (perDay[k]) {
      streak++;
      k = shift(k, -1);
    }
    const windowTotal = series.reduce((s, p) => s + p.done, 0);
    return { doneToday, series, streak, windowTotal };
  }, [tasks, day]);

  const effort = doneToday.reduce((s, t) => s + t.total_seconds, 0);
  const plannedDone = planned?.filter((t) => t.status === "done").length ?? 0;
  const rate = planned?.length ? Math.round((plannedDone / planned.length) * 100) : null;

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-semibold">
        {title} <span className="font-normal text-slate-400">{doneToday.length}</span>
      </h2>

      {/* ---- metrics ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Tasks done" value={String(doneToday.length)} />
        {planned ? (
          <Tile
            label="Plan completed"
            value={rate == null ? "—" : `${rate}%`}
            sub={`${plannedDone} of ${planned.length} planned`}
            meter={rate ?? 0}
          />
        ) : (
          <Tile label={`Last ${WINDOW} days`} value={String(windowTotal)} sub={`${(windowTotal / WINDOW).toFixed(1)} / day avg`} />
        )}
        <Tile label="Time on done tasks" value={formatDuration(effort)} sub="tracked, all sessions" />
        <Tile label="Streak" value={`${streak} ${streak === 1 ? "day" : "days"}`} sub="with ≥1 task done" />
      </div>

      {/* ---- 14-day trend ---- */}
      <div>
        <div className="mb-1 text-xs text-slate-500">Tasks done per day · last {WINDOW} days</div>
        <div className="h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} minTickGap={12} stroke="#94a3b8" />
              <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} stroke="#94a3b8" />
              <Tooltip content={<DayTip />} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
              <Bar
                dataKey="done"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                onClick={onSelectDay ? (p: any) => onSelectDay(p.key) : undefined}
                className={onSelectDay ? "cursor-pointer" : ""}
              >
                {series.map((p) => (
                  <Cell key={p.key} fill={BAR} fillOpacity={p.key === day ? 1 : 0.4} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ---- one block per finished task ---- */}
      {doneToday.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {doneToday.map((t) => {
            const over = t.duration_minutes > 0 && t.total_seconds > t.duration_minutes * 60;
            return (
              <li
                key={t.id}
                className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-900/10"
              >
                <span className="mt-0.5 text-emerald-600" aria-hidden>
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm wrap-break-word">{t.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                    <span>
                      done{" "}
                      {parseUTC(t.completed_at!).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className={over ? "text-red-500" : ""}>
                      {t.total_seconds > 0 ? formatDuration(t.total_seconds) : "no time"} / plan{" "}
                      {formatMinutes(t.duration_minutes)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400 dark:border-slate-700">
          Nothing finished on this day yet — tick a task off to see it here.
        </p>
      )}
    </section>
  );
}

function Tile({ label, value, sub, meter }: { label: string; value: string; sub?: string; meter?: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{value}</div>
      {meter != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, meter)}%` }} />
        </div>
      )}
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function DayTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="font-medium">{p.long}</div>
      <div className="text-slate-500">
        {p.done} {p.done === 1 ? "task" : "tasks"} done
      </div>
    </div>
  );
}
