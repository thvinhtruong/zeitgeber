import { useEffect, useState } from "react";
import {
  api,
  parseUTC,
  SMART_LETTERS,
  type Goal,
  type GoalCategory,
  type SmartLetter,
} from "./api";
import { localDayKey } from "./format";

const CATEGORIES: GoalCategory[] = ["health", "job", "study"];

const categoryMeta: Record<GoalCategory, { icon: string }> = {
  health: { icon: "💪" },
  job: { icon: "💼" },
  study: { icon: "📚" },
};

const letterLabel: Record<SmartLetter, string> = {
  specific: "Specific",
  measurable: "Measurable",
  achievable: "Achievable",
  relevant: "Relevant",
  time_bound: "Time-bound",
};

const scoreStyle = (score: number) =>
  score >= 80
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : score >= 50
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";

const today = () => localDayKey(new Date());

// "in 12 days" / "today" / "3 days overdue", counted in local calendar days
function dueLabel(day: string): { text: string; overdue: boolean } {
  const [y, m, d] = day.split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (diff === 0) return { text: "due today", overdue: false };
  if (diff > 0) return { text: `in ${diff} day${diff === 1 ? "" : "s"}`, overdue: false };
  return { text: `${-diff} day${diff === -1 ? "" : "s"} overdue`, overdue: true };
}

export default function GoalsView() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filter, setFilter] = useState<GoalCategory | "all">("all");
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  // goals with an assessment request in flight
  const [assessing, setAssessing] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setGoals((await api.goals()).goals);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const replace = (g: Goal) => setGoals((cur) => cur.map((x) => (x.id === g.id ? g : x)));

  async function assess(id: number) {
    setAssessing((s) => new Set(s).add(id));
    setError(null);
    try {
      replace(await api.assessGoal(id, today()));
      setExpanded(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAssessing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function create(draft: Pick<Goal, "title" | "details" | "category" | "target_date">) {
    try {
      const g = await api.createGoal(draft);
      setGoals((cur) => [g, ...cur]);
      assess(g.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function update(id: number, patch: Parameters<typeof api.updateGoal>[1], reassess = false) {
    try {
      replace(await api.updateGoal(id, patch));
      if (reassess) assess(id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove(id: number) {
    try {
      await api.removeGoal(id);
      setGoals((cur) => cur.filter((g) => g.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  const visible = goals.filter(
    (g) => (filter === "all" || g.category === filter) && (showClosed || g.status === "active"),
  );
  const closedCount = goals.filter((g) => g.status !== "active").length;
  const groups = (filter === "all" ? CATEGORIES : [filter])
    .map((c) => ({ category: c, goals: visible.filter((g) => g.category === c) }))
    .filter((grp) => grp.goals.length || filter !== "all");

  return (
    <div className="space-y-4">
      <NewGoalForm defaultCategory={filter === "all" ? "job" : filter} onCreate={create} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(["all", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium capitalize ${
                filter === c
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {c === "all" ? "All" : `${categoryMeta[c].icon} ${c}`}
            </button>
          ))}
        </div>
        {closedCount > 0 && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show achieved / dropped ({closedCount})
          </label>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-400">
          No goals yet. Write one above — the AI will tell you how S.M.A.R.T it is.
        </p>
      )}

      {groups.map(({ category, goals }) => (
        <section key={category}>
          <h2 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold capitalize text-slate-600 dark:text-slate-300">
            {categoryMeta[category].icon} {category}
            <span className="font-normal text-slate-400">{goals.length}</span>
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {goals.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                open={expanded === g.id}
                assessing={assessing.has(g.id)}
                onToggle={() => setExpanded((cur) => (cur === g.id ? null : g.id))}
                onAssess={() => assess(g.id)}
                onUpdate={(patch, reassess) => update(g.id, patch, reassess)}
                onRemove={() => remove(g.id)}
              />
            ))}
            {goals.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No {category} goals.</li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NewGoalForm({
  defaultCategory,
  onCreate,
}: {
  defaultCategory: GoalCategory;
  onCreate: (g: Pick<Goal, "title" | "details" | "category" | "target_date">) => void;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [category, setCategory] = useState<GoalCategory>(defaultCategory);
  const [target, setTarget] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => setCategory(defaultCategory), [defaultCategory]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), details, category, target_date: target || null });
    setTitle("");
    setDetails("");
    setTarget("");
    setShowDetails(false);
  }

  const input =
    "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950";

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New goal — e.g. Run 10 km in under 55 minutes"
          className={`min-w-[14rem] flex-1 ${input}`}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as GoalCategory)}
          className={`cursor-pointer capitalize ${input}`}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryMeta[c].icon} {c}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          title="Target date"
          className={input}
        />
        <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50" disabled={!title.trim()}>
          Add goal
        </button>
      </div>
      {showDetails ? (
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          placeholder="Why it matters, how you'll measure it…"
          className={`w-full ${input}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="text-xs text-slate-400 hover:text-indigo-600"
        >
          + add details
        </button>
      )}
    </form>
  );
}

function GoalRow({
  goal: g,
  open,
  assessing,
  onToggle,
  onAssess,
  onUpdate,
  onRemove,
}: {
  goal: Goal;
  open: boolean;
  assessing: boolean;
  onToggle: () => void;
  onAssess: () => void;
  onUpdate: (patch: Parameters<typeof api.updateGoal>[1], reassess?: boolean) => void;
  onRemove: () => void;
}) {
  const closed = g.status !== "active";
  const due = g.target_date ? dueLabel(g.target_date) : null;

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input
          type="checkbox"
          checked={g.status === "achieved"}
          onChange={(e) => onUpdate({ status: e.target.checked ? "achieved" : "active" })}
          title="Mark achieved"
          className="cursor-pointer"
        />
        <button onClick={onToggle} className="min-w-0 flex-1 cursor-pointer text-left">
          <span className={`block truncate text-sm ${closed ? "text-slate-400 line-through" : ""}`}>{g.title}</span>
          <span className="flex gap-2 text-xs text-slate-400">
            {g.status === "dropped" && <span>dropped</span>}
            {g.target_date && (
              <span className={due?.overdue && !closed ? "text-red-500" : ""}>
                {g.target_date} · {due?.text}
              </span>
            )}
          </span>
        </button>
        {assessing ? (
          <span className="animate-pulse rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
            Assessing…
          </span>
        ) : g.smart_score != null ? (
          <button
            onClick={onToggle}
            title="S.M.A.R.T score"
            className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${scoreStyle(g.smart_score)}`}
          >
            SMART {g.smart_score}
          </button>
        ) : (
          <button
            onClick={onAssess}
            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800"
          >
            Assess
          </button>
        )}
        <button onClick={onToggle} className="text-slate-400 hover:text-slate-700" aria-label="Details">
          {open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <div className="space-y-3 bg-slate-50/70 px-4 py-3 dark:bg-slate-800/30">
          {g.assessment ? (
            <>
              <ul className="space-y-1.5">
                {SMART_LETTERS.map((l) => {
                  const c = g.assessment!.criteria[l];
                  return (
                    <li key={l} className="flex items-start gap-3 text-sm">
                      <span className="w-5 shrink-0 text-center text-base font-bold text-indigo-600 dark:text-indigo-400">
                        {letterLabel[l][0]}
                      </span>
                      <span className="w-24 shrink-0 text-slate-500">{letterLabel[l]}</span>
                      <span className="flex shrink-0 gap-0.5 pt-1.5" title={`${c.score}/5`}>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <span
                            key={i}
                            className={`h-2 w-2 rounded-full ${i <= c.score ? (c.score >= 4 ? "bg-emerald-500" : c.score >= 3 ? "bg-amber-500" : "bg-red-500") : "bg-slate-200 dark:bg-slate-700"}`}
                          />
                        ))}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">{c.feedback}</span>
                    </li>
                  );
                })}
              </ul>
              {g.assessment.summary && <p className="text-sm text-slate-600 dark:text-slate-300">{g.assessment.summary}</p>}
              {g.assessment.suggestion && g.assessment.suggestion !== g.title && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm dark:border-indigo-900 dark:bg-indigo-900/20">
                  <span className="text-xs font-medium uppercase tracking-wide text-indigo-500">Suggested</span>
                  <span className="flex-1">{g.assessment.suggestion}</span>
                  <button
                    onClick={() => onUpdate({ title: g.assessment!.suggestion })}
                    disabled={assessing}
                    className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Use this
                  </button>
                </div>
              )}
            </>
          ) : (
            !assessing && <p className="text-sm text-slate-400">Not assessed yet.</p>
          )}

          <GoalEditor goal={g} onSave={(patch) => onUpdate(patch, true)} />

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button onClick={onAssess} disabled={assessing} className="text-indigo-600 hover:underline disabled:opacity-50">
              {g.assessment ? "Re-assess" : "Assess"}
            </button>
            {g.assessed_at && (
              <span className="text-slate-400">
                assessed {parseUTC(g.assessed_at).toLocaleString()}
              </span>
            )}
            <span className="ml-auto flex gap-3">
              <button
                onClick={() => onUpdate({ status: g.status === "dropped" ? "active" : "dropped" })}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                {g.status === "dropped" ? "Reactivate" : "Drop"}
              </button>
              <button onClick={onRemove} className="text-slate-400 hover:text-red-500">
                Delete
              </button>
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

// Inline edit of the fields the assessment depends on; saving re-assesses.
function GoalEditor({
  goal,
  onSave,
}: {
  goal: Goal;
  onSave: (patch: Pick<Goal, "title" | "details" | "category" | "target_date">) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [details, setDetails] = useState(goal.details);
  const [category, setCategory] = useState(goal.category);
  const [target, setTarget] = useState(goal.target_date ?? "");

  if (!editing)
    return (
      <div className="text-sm">
        {goal.details && <p className="mb-1 whitespace-pre-wrap text-slate-500">{goal.details}</p>}
        <button
          onClick={() => {
            setTitle(goal.title);
            setDetails(goal.details);
            setCategory(goal.category);
            setTarget(goal.target_date ?? "");
            setEditing(true);
          }}
          className="text-xs text-slate-500 hover:text-indigo-600"
        >
          ✎ Edit goal
        </button>
      </div>
    );

  const input =
    "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSave({ title: title.trim(), details, category, target_date: target || null });
        setEditing(false);
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`min-w-[14rem] flex-1 ${input}`} />
        <select value={category} onChange={(e) => setCategory(e.target.value as GoalCategory)} className={`capitalize ${input}`}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryMeta[c].icon} {c}
            </option>
          ))}
        </select>
        <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} className={input} />
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        rows={2}
        placeholder="Why it matters, how you'll measure it…"
        className={`w-full ${input}`}
      />
      <div className="flex gap-2">
        <button className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">
          Save & re-assess
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">
          Cancel
        </button>
      </div>
    </form>
  );
}
