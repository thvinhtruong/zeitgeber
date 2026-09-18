import { formatDuration } from "./format";
import type { useIdleAutoStop } from "./useIdleAutoStop";
import type { useLockedIn } from "./useLockedIn";

// The header home of the two session flags — locked-in mode (nag me while I'm
// not tracking, and take over the screen once a timer's running) and auto-stop
// (drop the timer when I walk away) — as a matched pair of always-visible
// chips. They're flipped many times a day, so they sit in the open rather than
// behind a disclosure.
//
// Both flags' hooks are mounted one level up, in AppBody — not here — because
// entering locked-in mode replaces this component (and the whole header) with
// LockedInView, and the reminder clock / idle watcher must keep running
// regardless of which shell is on screen. This component is purely
// presentational: two chips plus the sr-only nudge announcement.

function FlagChip({
  label,
  title,
  checked,
  onChange,
  notice,
}: {
  label: string;
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  notice?: string | null;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={notice ? `${title}\n\n${notice}` : title}
      onClick={() => onChange(!checked)}
      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
        checked
          ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-900/25 dark:text-indigo-300"
          : "border-slate-200 bg-white text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
      } ${notice ? "ring-2 ring-amber-400/50" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export default function TrackingStatus({
  lockedIn,
  idle,
  error,
}: {
  lockedIn: ReturnType<typeof useLockedIn>;
  idle: ReturnType<typeof useIdleAutoStop>;
  error?: string | null;
}) {
  return (
    <>
      <FlagChip
        label="Locked in"
        title="Locked-in mode — takes over the screen with the running task and reminds you every 5 min while no timer is running. Switching it off stops the running timer."
        checked={lockedIn.on}
        onChange={lockedIn.toggle}
        notice={lockedIn.notice ?? error}
      />
      <FlagChip
        label="Auto-idle"
        title="Auto-stop when idle — stops the timer after 15 min with no keyboard, mouse, or unlocked screen."
        checked={idle.autoStop}
        onChange={idle.toggleAutoStop}
        notice={idle.idleMsg}
      />

      {/* the reminder has no visual home now, so keep announcing it */}
      <span role="status" aria-live="polite" className="sr-only">
        {lockedIn.nudging ? `Not tracking for ${formatDuration(lockedIn.untrackedMs / 1000)}` : ""}
      </span>
    </>
  );
}
