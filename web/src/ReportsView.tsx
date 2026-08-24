import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, parseUTC, type ReportEntry } from "./api";
import { formatDuration, localDayKey } from "./format";

// Reports answer two different questions, so the view is two halves:
//
//   "how is today going?"      -> the Today card, always the current local day
//   "how have I been doing?"   -> the trend + per-task breakdown over a range
//                                 the user picks (week … year)
//
// Only the first one is on screen by default: opening Reports is nearly always
// a "how's today?" question, so the day stands alone and the look-back is one
// click away rather than something to scroll past. Picking a range reveals the
// second half; Hide puts it away again.
//
// Every range ends today, so whichever is on screen comes from a single
// /api/report call: the Today card just clips the fetched entries to local
// midnight, and with no range picked the fetch is today's window alone.
//
// Throughout, time is split by *kind of task* — recurring (the daily/weekly
// habits) vs one-off — because an hour of routine and an hour of project work
// mean different things when you read the chart.

// Categorical slots 1 (blue) and 2 (orange) of the validated default palette.
// Worst-pair separation: CVD ΔE 24.7, normal-vision ΔE 33.6, both ≥ 3:1 on the
// card surface. Colour follows the kind of task, never its rank — a task never
// changes colour because the range changed.
const COLOR = { once: "#2a78d6", recurring: "#eb6834" } as const;

type Kind = keyof typeof COLOR;
type RangeKey = "week" | "month" | "3m" | "6m" | "year";
type Bucket = "day" | "week" | "month";

const RANGES: { key: RangeKey; label: string; days: number; bucket: Bucket }[] = [
  { key: "week", label: "Week", days: 7, bucket: "day" },
  { key: "month", label: "Month", days: 30, bucket: "day" },
  { key: "3m", label: "3 months", days: 90, bucket: "week" },
  { key: "6m", label: "6 months", days: 180, bucket: "week" },
  { key: "year", label: "Year", days: 365, bucket: "month" },
];

const BUCKET_NOUN: Record<Bucket, string> = {
  day: "Daily totals",
  week: "Weekly totals",
  month: "Monthly totals",
};

type Row = { taskId: number; title: string; kind: Kind; seconds: number };
type Split = { rows: Row[]; total: number; recurring: number; once: number };

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function todayWindow(): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  return { from: startOfToday(), to };
}

function rangeFor(key: RangeKey): { from: Date; to: Date } {
  const days = RANGES.find((r) => r.key === key)!.days;
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = startOfToday();
  from.setDate(from.getDate() - (days - 1));
  return { from, to };
}

// Seconds of an entry that fall inside [from, to] (ms epoch, optional).
function clippedSeconds(e: ReportEntry, from?: number, to?: number): number {
  const start = Math.max(parseUTC(e.started_at).getTime(), from ?? -Infinity);
  const end = Math.min(parseUTC(e.ended_at).getTime(), to ?? Infinity);
  return end > start ? (end - start) / 1000 : 0;
}

// A recurring task keeps `recurrence` set even on the days it's ticked off (its
// status flips to 'done'), so recurrence — not status — is what separates the
// habits from the one-off work.
const kindOf = (e: ReportEntry): Kind =>
  e.recurrence !== "none" || e.status === "recurring" ? "recurring" : "once";

function splitByTask(entries: ReportEntry[], from?: number, to?: number): Split {
  const byTask = new Map<number, Row>();
  let recurring = 0;
  let once = 0;
  for (const e of entries) {
    const secs = clippedSeconds(e, from, to);
    if (secs <= 0) continue;
    const kind = kindOf(e);
    if (kind === "recurring") recurring += secs;
    else once += secs;
    const cur = byTask.get(e.task_id) ?? { taskId: e.task_id, title: e.title, kind, seconds: 0 };
    cur.seconds += secs;
    byTask.set(e.task_id, cur);
  }
  const rows = [...byTask.values()].sort((a, b) => b.seconds - a.seconds);
  return { rows, total: recurring + once, recurring, once };
}

// The local day a bucket starts on: the day itself, its Monday, or the 1st of
// its month. Keying on a real date (not an ISO week number) means buckets sort
// naturally, label as dates, and can be enumerated to fill the empty ones.
function bucketStart(d: Date, bucket: Bucket): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (bucket === "week") s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // Mon
  else if (bucket === "month") s.setDate(1);
  return s;
}

const stepBucket = (d: Date, bucket: Bucket) => {
  const n = new Date(d);
  if (bucket === "day") n.setDate(n.getDate() + 1);
  else if (bucket === "week") n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
};

function bucketLabels(start: Date, bucket: Bucket): { label: string; full: string } {
  const md = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (bucket === "day") return { label: md, full: start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) };
  if (bucket === "week") return { label: md, full: `Week of ${md}` };
  const mon = start.toLocaleDateString(undefined, { month: "short" });
  return { label: mon, full: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ---------- pieces ----------

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
      {(
        [
          ["once", "One-off"],
          ["recurring", "Recurring"],
        ] as [Kind, string][]
      ).map(([kind, label]) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: COLOR[kind] }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

function Card({
  title,
  aside,
  children,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// One 100%-stacked meter: the recurring / one-off mix at a glance. The 2px gap
// between segments keeps the boundary readable without a border.
function SplitMeter({ recurring, once }: { recurring: number; once: number }) {
  const total = recurring + once;
  if (total <= 0) return null;
  return (
    <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      {once > 0 && (
        <div style={{ width: `${(once / total) * 100}%`, background: COLOR.once }} />
      )}
      {recurring > 0 && (
        <div
          style={{ width: `${(recurring / total) * 100}%`, background: COLOR.recurring }}
        />
      )}
    </div>
  );
}

// Per-task totals as rows, not columns: a full-width bar per task reads top to
// bottom like a list and leaves room for the task title unrotated. Bars are
// scaled to `max` (the biggest task anywhere in the report) so lengths stay
// comparable across the recurring / one-off groups.
function TaskRows({ rows, max, total }: { rows: Row[]; max: number; total: number }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.taskId}>
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
              {r.title}
            </span>
            <span className="font-mono text-sm tabular-nums text-slate-600 dark:text-slate-300">
              {formatDuration(r.seconds)}
            </span>
            <span className="w-9 text-right text-xs tabular-nums text-slate-400">
              {pct(r.seconds, total)}%
            </span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${max > 0 ? Math.max((r.seconds / max) * 100, 1.5) : 0}%`,
                background: COLOR[r.kind],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// A long range can hold a hundred one-off tasks; showing them all buries the
// ranking that the group is for. Top TOP_N, the rest one click away.
const TOP_N = 8;

function Group({
  kind,
  label,
  rows,
  max,
  total,
}: {
  kind: Kind;
  label: string;
  rows: Row[];
  max: number;
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const groupTotal = rows.reduce((s, r) => s + r.seconds, 0);
  const shown = expanded ? rows : rows.slice(0, TOP_N);
  const hidden = rows.length - shown.length;
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: COLOR[kind] }}
          />
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          {formatDuration(groupTotal)}
        </span>
      </div>
      {rows.length ? (
        <>
            <TaskRows rows={shown} max={max} total={total} />
            {(hidden > 0 || expanded) && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 w-full cursor-pointer rounded-md border border-slate-200 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {expanded ? "Show less" : `Show ${hidden} more`}
              </button>
            )}
        </>
      ) : (
        <p className="py-4 text-center text-xs text-slate-400">Nothing tracked here.</p>
      )}
    </div>
  );
}

// Sub-minute gaps are timer-switch noise (stop one task, start the next a
// few seconds later), not a rest worth naming — fold them into whichever
// entry is next to them instead of showing a "Rest: 0m" row.
const MIN_REST_MS = 60_000;

type TimelineBlock =
  | { kind: "entry"; start: number; end: number; title: string; color: string }
  | { kind: "rest"; start: number; end: number };

// Today's tracked spans in chronological order, with the gaps between them —
// and the stretch since the last one, up to now — turned into explicit rest
// blocks. This is what answers "when did I track task X" and "how long have
// I actually been resting" without hovering anything.
function buildTimeline(entries: ReportEntry[], dayStart: number, now: number): TimelineBlock[] {
  const spans = entries
    .map((e) => {
      const start = Math.max(parseUTC(e.started_at).getTime(), dayStart);
      const end = Math.min(parseUTC(e.ended_at).getTime(), now);
      return end > start ? { start, end, title: e.title, color: COLOR[kindOf(e)] } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return [];

  const blocks: TimelineBlock[] = [];
  let cursor = spans[0].start;
  for (const s of spans) {
    if (s.start - cursor >= MIN_REST_MS) blocks.push({ kind: "rest", start: cursor, end: s.start });
    blocks.push({ kind: "entry", start: s.start, end: s.end, title: s.title, color: s.color });
    cursor = Math.max(cursor, s.end);
  }
  if (now - cursor >= MIN_REST_MS) blocks.push({ kind: "rest", start: cursor, end: now });
  return blocks;
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// The chronological view of today: a bar (gaps read as rest at a glance) plus
// an exact list underneath, since two same-kind entries look identical on the
// bar and hover doesn't work well on touch.
function Timeline({ blocks }: { blocks: TimelineBlock[] }) {
  const hourMs = 3_600_000;
  const boundStart = Math.floor(blocks[0].start / hourMs) * hourMs;
  const boundEnd = Math.ceil(blocks[blocks.length - 1].end / hourMs) * hourMs;
  const span = Math.max(boundEnd - boundStart, hourMs);
  const pct = (t: number) => ((t - boundStart) / span) * 100;

  const totalHours = span / hourMs;
  const tickEvery = totalHours <= 6 ? 1 : totalHours <= 12 ? 2 : totalHours <= 24 ? 3 : 4;
  const ticks: number[] = [];
  for (let t = boundStart; t < boundEnd; t += tickEvery * hourMs) ticks.push(t);
  ticks.push(boundEnd);

  const rest = blocks
    .filter((b) => b.kind === "rest")
    .reduce((s, b) => s + (b.end - b.start) / 1000, 0);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium">Timeline</span>
        {rest > 0 && <span>Rest: {formatDuration(rest)}</span>}
      </div>

      <div className="relative h-7 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        {blocks
          .filter((b): b is Extract<TimelineBlock, { kind: "entry" }> => b.kind === "entry")
          .map((b, i) => (
            <div
              key={i}
              title={`${b.title} · ${fmtTime(b.start)}–${fmtTime(b.end)} · ${formatDuration((b.end - b.start) / 1000)}`}
              className="absolute top-0 h-full"
              style={{
                left: `${pct(b.start)}%`,
                width: `${Math.max(pct(b.end) - pct(b.start), 0.4)}%`,
                background: b.color,
              }}
            />
          ))}
      </div>

      <div className="relative mt-1 h-4 text-[10px] text-slate-400">
        {ticks.map((t) => {
          const p = pct(t);
          const edge = p < 4 ? "start" : p > 96 ? "end" : "mid";
          return (
            <span
              key={t}
              className={
                edge === "start"
                  ? "absolute left-0"
                  : edge === "end"
                    ? "absolute right-0"
                    : "absolute -translate-x-1/2"
              }
              style={edge === "mid" ? { left: `${p}%` } : undefined}
            >
              {fmtTime(t)}
            </span>
          );
        })}
      </div>

      <ul className="mt-3 space-y-1 font-mono text-xs tabular-nums">
        {blocks.map((b, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className={
                b.kind === "entry"
                  ? "inline-block h-2 w-2 shrink-0 rounded-full"
                  : "inline-block h-2 w-2 shrink-0 rounded-full border border-slate-300 dark:border-slate-600"
              }
              style={b.kind === "entry" ? { background: b.color } : undefined}
            />
            <span className="shrink-0 whitespace-nowrap text-slate-500 dark:text-slate-400">
              {fmtTime(b.start)}–{fmtTime(b.end)}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${
                b.kind === "rest"
                  ? "text-slate-400 italic dark:text-slate-500"
                  : "text-slate-700 dark:text-slate-200"
              }`}
            >
              {b.kind === "entry" ? b.title : "Rest"}
            </span>
            <span className="shrink-0 text-slate-400">
              {formatDuration((b.end - b.start) / 1000)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const heading = payload[0]?.payload?.full ?? label;
  const once = payload.find((p: any) => p.dataKey === "once")?.value ?? 0;
  const recurring = payload.find((p: any) => p.dataKey === "recurring")?.value ?? 0;
  const line = (kind: Kind, name: string, hours: number) => (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: COLOR[kind] }}
      />
      <span className="flex-1 text-slate-500 dark:text-slate-400">{name}</span>
      <span className="font-mono tabular-nums">{formatDuration(hours * 3600)}</span>
    </div>
  );
  return (
    <div className="min-w-[11rem] space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="font-medium text-slate-700 dark:text-slate-200">{heading}</div>
      {line("once", "One-off", once)}
      {line("recurring", "Recurring", recurring)}
      <div className="flex items-center gap-2 border-t border-slate-100 pt-1 dark:border-slate-800">
        <span className="flex-1 text-slate-500 dark:text-slate-400">Total</span>
        <span className="font-mono tabular-nums">{formatDuration((once + recurring) * 3600)}</span>
      </div>
    </div>
  );
}

// ---------- view ----------

export default function ReportsView() {
  // null = today only, the default view
  const [rangeKey, setRangeKey] = useState<RangeKey | null>(null);
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = rangeKey ? RANGES.find((r) => r.key === rangeKey)! : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // no range picked -> fetch today's window only, not a year of entries
      const { from, to } = rangeKey ? rangeFor(rangeKey) : todayWindow();
      const r = await api.report(from, to);
      setEntries(r.entries);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [rangeKey]);

  useEffect(() => {
    load();
  }, [load]);

  const today = useMemo(
    () => splitByTask(entries, startOfToday().getTime(), Date.now()),
    [entries],
  );
  const timelineBlocks = useMemo(
    () => buildTimeline(entries, startOfToday().getTime(), Date.now()),
    [entries],
  );
  const period = useMemo(() => splitByTask(entries), [entries]);

  // Every bucket in the range gets a column, tracked or not: a week off is a
  // fact about the range, and silently dropping it would stretch the time axis.
  const chartData = useMemo(() => {
    if (!range || !rangeKey) return [];
    const sums = new Map<string, { once: number; recurring: number }>();
    for (const e of entries) {
      const secs = clippedSeconds(e);
      if (secs <= 0) continue;
      const key = localDayKey(bucketStart(parseUTC(e.started_at), range.bucket));
      const cur = sums.get(key) ?? { once: 0, recurring: 0 };
      cur[kindOf(e)] += secs;
      sums.set(key, cur);
    }
    const out: { label: string; full: string; once: number; recurring: number }[] = [];
    const last = bucketStart(new Date(), range.bucket);
    for (
      let d = bucketStart(rangeFor(rangeKey).from, range.bucket);
      d <= last;
      d = stepBucket(d, range.bucket)
    ) {
      const v = sums.get(localDayKey(d)) ?? { once: 0, recurring: 0 };
      out.push({
        ...bucketLabels(d, range.bucket),
        once: +(v.once / 3600).toFixed(2),
        recurring: +(v.recurring / 3600).toFixed(2),
      });
    }
    return out;
  }, [entries, range, rangeKey]);

  const max = Math.max(0, ...period.rows.map((r) => r.seconds));
  const todayMax = Math.max(0, ...today.rows.map((r) => r.seconds));

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ---- today, always the current day ---- */}
      <Card
        title="Today"
        aside={
          <span className="text-xs text-slate-500">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {formatDuration(today.total)}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">tracked so far today</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: COLOR.once }}
                />
                One-off
              </div>
              <div className="mt-1 font-mono tabular-nums">{formatDuration(today.once)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: COLOR.recurring }}
                />
                Recurring
              </div>
              <div className="mt-1 font-mono tabular-nums">
                {formatDuration(today.recurring)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <SplitMeter recurring={today.recurring} once={today.once} />
        </div>

        {timelineBlocks.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Timeline blocks={timelineBlocks} />
          </div>
        )}

        <div className="mt-4">
          {today.rows.length ? (
            <TaskRows rows={today.rows} max={todayMax} total={today.total} />
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">
              {loading ? "Loading…" : "Nothing tracked today yet."}
            </p>
          )}
        </div>
      </Card>

      {/* ---- the look-back: nothing below this exists until a range is picked ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">Look back over</span>
          <div
            role="group"
            aria-label="Report range"
            className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
          >
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRangeKey(r.key)}
                aria-pressed={rangeKey === r.key}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  rangeKey === r.key
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {range && (
            <button
              onClick={() => setRangeKey(null)}
              className="cursor-pointer rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:hover:text-slate-200"
            >
              ✕ Hide
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {range && <Legend />}
          <button
            onClick={load}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {range && (
        <>
      {/* ---- trend over the range ---- */}
      <Card
        title={`${BUCKET_NOUN[range.bucket]} · last ${range.label.toLowerCase()}`}
        aside={
          <span className="text-sm text-slate-500">
            Total: <span className="font-mono tabular-nums">{formatDuration(period.total)}</span>
          </span>
        }
      >
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="label"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
                stroke="#94a3b8"
              />
              <YAxis
                fontSize={12}
                tickLine={false}
                axisLine={false}
                unit="h"
                allowDecimals
                stroke="#94a3b8"
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
              <Bar dataKey="once" stackId="t" fill={COLOR.once} name="One-off" />
              <Bar
                dataKey="recurring"
                stackId="t"
                fill={COLOR.recurring}
                name="Recurring"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {chartData.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            {loading ? "Loading…" : "No tracked time in this range."}
          </p>
        )}
      </Card>

      {/* ---- per-task totals, recurring kept apart from one-off ---- */}
      <Card
        title="Time per task"
        aside={
          <span className="text-xs text-slate-500">
            {formatDuration(period.once)} one-off · {formatDuration(period.recurring)} recurring
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Group
            kind="once"
            label="One-off tasks"
            rows={period.rows.filter((r) => r.kind === "once")}
            max={max}
            total={period.total}
          />
          <Group
            kind="recurring"
            label="Recurring tasks"
            rows={period.rows.filter((r) => r.kind === "recurring")}
            max={max}
            total={period.total}
          />
        </div>
      </Card>
        </>
      )}
    </div>
  );
}
