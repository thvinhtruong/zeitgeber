import { useCallback, useEffect, useRef, useState } from "react";
import type { Active } from "./api";

// Locked-in mode — a manual "I'm working right now" switch, and the companion
// to useIdleAutoStop:
//
//   auto-stop  →  you went idle 15 min, so the timer stops on its own
//   locked in  →  a timer isn't running, so you get reminded every 5 min, and
//                 the whole UI swaps to a single-task takeover view
//
// Presence is declared, not detected: while locked in you are saying you
// intend to be tracking, so any untracked stretch is worth a nudge. Finishing
// work means switching locked-in mode off, which also stops whatever is
// running — so the "stop nagging me" action and the "I'm done" action are the
// same one, and there is deliberately no exit confirmation.
//
// (This hook used to be called useFocusMode / key "ad-focus" — the reminder
// engine below is unchanged, only its presentation grew a takeover view.)

const KEY = "ad-locked-in";
const BASE_TITLE = "Zeitgeber";
const NUDGE_EVERY_MS = 5 * 60_000;
const TICK_MS = 15_000;

type Options = {
  active: Active | null;
  runningLabel?: string; // shown in the tab title while tracking
  onStopTimer: () => Promise<unknown> | unknown; // switching off ends the session
};

export function useLockedIn({ active, runningLabel, onStopTimer }: Options) {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) === "1");
  const [notice, setNotice] = useState<string | null>(null);
  const [untrackedMs, setUntrackedMs] = useState(0);

  // start of the current untracked stretch; null while a timer runs
  const sinceRef = useRef<number | null>(null);
  const nudgesRef = useRef(0);
  const onRef = useRef(on);
  onRef.current = on;
  const activeRef = useRef(active);
  activeRef.current = active;
  const labelRef = useRef(runningLabel);
  labelRef.current = runningLabel;

  const tickRef = useRef<() => void>(() => {});
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const setTitle = (t: string) => {
      if (document.title !== t) document.title = t;
    };

    function tick() {
      if (!onRef.current) {
        sinceRef.current = null;
        nudgesRef.current = 0;
        setUntrackedMs(0);
        setTitle(BASE_TITLE);
        return;
      }

      if (activeRef.current) {
        sinceRef.current = null;
        nudgesRef.current = 0;
        setUntrackedMs(0);
        setTitle(labelRef.current ? `● ${labelRef.current} · ${BASE_TITLE}` : `● ${BASE_TITLE}`);
        return;
      }

      const now = Date.now();
      if (sinceRef.current === null) sinceRef.current = now;
      // elapsed is always a clock delta, never a count of ticks — a hidden tab
      // throttles this interval to roughly once a minute
      const elapsed = now - sinceRef.current;
      setUntrackedMs(elapsed);

      // reminders land at 5, 10, 15… minutes untracked
      if (elapsed >= (nudgesRef.current + 1) * NUDGE_EVERY_MS) {
        nudgesRef.current += 1;
        notify(Math.round(elapsed / 60_000));
        chime(audioCtxRef.current);
      }

      setTitle(nudgesRef.current > 0 ? `⏸ Not tracking · ${BASE_TITLE}` : BASE_TITLE);
    }

    tickRef.current = tick;
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(id);
      document.title = BASE_TITLE;
    };
  }, []);

  // starting or stopping a timer must flip the pill and title now, not up to a
  // tick later; tick() derives everything from `active`
  useEffect(() => {
    tickRef.current();
  }, [active, on]);

  const toggle = useCallback(
    async (want: boolean) => {
      setNotice(null);

      if (!want) {
        setOn(false);
        localStorage.setItem(KEY, "0");
        // switching off is the "I'm done" action — end the running session too
        if (activeRef.current) await onStopTimer();
        return;
      }

      sinceRef.current = Date.now();
      nudgesRef.current = 0;
      setOn(true);
      localStorage.setItem(KEY, "1");

      // Created/resumed on the click, not lazily inside the reminder tick —
      // browsers only allow audio to start from a user gesture, and this
      // toggle is the only gesture in the whole locked-in lifecycle.
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (Ctor) {
        if (!audioCtxRef.current) audioCtxRef.current = new Ctor();
        if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
      }

      // Permission is requested here, on the click — never on mount. It is
      // deliberately not awaited: an ignored prompt would otherwise leave the
      // switch looking dead, and the tab title works without it either way.
      if (!("Notification" in window)) {
        setNotice("This browser has no notification support — using the tab title instead.");
      } else if (Notification.permission === "denied") {
        setNotice(
          "Notifications are blocked for this site — you'll still get the tab title and the pill.",
        );
      } else if (Notification.permission === "default") {
        void Notification.requestPermission().then((res) => {
          if (res !== "granted") {
            setNotice("Notifications blocked — you'll still get the tab title and the pill.");
          }
        });
      }
    },
    [onStopTimer],
  );

  const nextNudgeMs = on && !active ? (nudgesRef.current + 1) * NUDGE_EVERY_MS - untrackedMs : 0;

  return {
    on,
    toggle,
    notice,
    untrackedMs,
    nextNudgeMs: Math.max(0, nextNudgeMs),
    nudging: nudgesRef.current > 0,
  };
}

// Two short beeps — audible over the OS notification's own (silent) chime,
// and independent of notification permission so it still fires when that's
// denied. `ctx` is created/resumed on the toggle-on click (autoplay policy).
function chime(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    [0, 0.18].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    });
  } catch {
    // some platforms throw on a stale/closed context — the notification and
    // tab title still carry the reminder
  }
}

function notify(minutes: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification("Not tracking any task", {
      body: `Locked-in mode is on and you've been off the clock for ${minutes} min.`,
      tag: "ad-locked-in", // replaces the previous reminder instead of stacking
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // some platforms throw on construction — the tab title still carries it
  }
}
