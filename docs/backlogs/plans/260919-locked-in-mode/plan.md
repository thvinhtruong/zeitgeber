<plan>
  <meta>
    <title>Locked-in mode — full-screen takeover replacing focus mode's chip-only UX</title>
    <status>completed</status>
  </meta>

  <context>
    <ref>docs/architecture.md#the-two-session-flags-uselockedints-useidleautostopts</ref>
    <ref>docs/backlogs/plans/260818-focus-mode/plan.md</ref>
  </context>

  <targets>
    <file>web/src/useFocusMode.ts</file> <!-- renamed to useLockedIn.ts -->
    <file>web/src/TrackingStatus.tsx</file>
    <file>web/src/App.tsx</file>
    <file>web/src/AppBody.tsx</file> <!-- new: hook-owning shell, split out of App.tsx -->
    <file>web/src/LockedInView.tsx</file>
    <file>docs/architecture.md</file>
    <file>docs/decision-log.md</file>
  </targets>

  <out-of-scope>
    Server changes of any kind — still client-only, no schema, no endpoint.
    Session-length commitment (Pomodoro-style countdown) — chosen direction is takeover-only, no forced duration.
    Exit confirmation dialog — off stays instant, same as focus mode today (that's the point: "stop nagging me" = "I'm done").
    Restricting browser-level navigation (URL bar, reload, devtools) — this is a UI-level shield, not a hard lock; the app is single-user/local with no enforcement layer to back a real lock.
  </out-of-scope>

  <requirements>
    <req>Presence stays DECLARED, not detected — no new idle detection is added; the reminder engine's logic (5-min nudge cadence, Date.now()-delta timing) is unchanged, only its presentation grows.</req>
    <req>Turning it off must stop the running timer AND instantly return to the normal 3-tab shell, exactly like focus mode today — no added friction.</req>
    <req>useIdleAutoStop and the reminder engine must keep running while the takeover view is showing — they are currently mounted by TrackingStatus, which lives in the header that the takeover view replaces. Don't let entering locked-in silently disable idle auto-stop or the tab-title/notification nudges.</req>
    <req>The takeover view must offer a way to start a task without leaving locked-in mode (no timer running is a real state, not just a transition) — otherwise turning it on before picking a task strands the user.</req>
    <req>Exiting is always reachable from inside the takeover view itself (no reliance on a header that's hidden).</req>
  </requirements>
</plan>

# Implementation Phases

## Phase 1 — Rename & restyle the flag
- [x] `TrackingStatus.tsx`: relabel the chip "Focus" → "Locked in" (icon + tooltip copy).
- [x] Renamed `useFocusMode.ts` → `useLockedIn.ts`, localStorage key `ad-focus` → `ad-locked-in`, notification tag likewise — pure rename, reminder logic byte-for-byte unchanged.

## Phase 2 — Takeover view
- [x] `LockedInView.tsx`: full-screen replacement for the tab shell. Two states:
  - **Tracking**: task title, a live ticking clock (`formatClock`, HH:MM:SS — chosen over `formatDuration`'s compact form since this is the one thing on screen), Stop button — nothing else.
  - **Not tracking**: a minimal filterable task picker (non-done, non-archived tasks) reusing `{ tasks, active }` already in `TrackingProvider` — no separate fetch.
  - Distinct visual theme (`bg-slate-950`, no tab chrome) so a glance tells you you're in a different mode.
  - Always-visible "🔓 Exit" corner button that flips the flag off — same instant stop-and-return behavior as the header chip.

## Phase 3 — Wiring
- [x] Split `App.tsx` into a thin `TrackingProvider` wrapper + new `AppBody.tsx`, which owns `useLockedIn`/`useIdleAutoStop` and renders either the normal shell (passing hook state to a now-presentational `TrackingStatus`) or `LockedInView`, so the hooks survive the shell swap.
- [x] Confirmed `document.title` / OS notification are unaffected by the view swap — verified live (see Verification), not just asserted from the hook being decoupled from the DOM tree.

## Verification
- [x] Ran the built app (`bun run build` + `bun run start`), drove it live in the browser via DOM-level clicks: toggled locked-in on with no timer running (picker appeared with real tasks), started a real task from the picker (live clock ticked, `document.title` flipped to `● <task> · Zeitgeber`), Stop returned to the picker, Exit returned to the normal header/nav instantly with the chip flipped off. Confirmed via `tsc --noEmit` (clean) and no console errors.
- [x] Confirmed idle auto-stop's chip/state carried through unaffected by the `AppBody` restructuring (same hook, same props, now passed down instead of self-mounted).
- [x] Updated `docs/architecture.md` (Frontend section, the two-session-flags subsection) — doc-sync.
- [x] Added a decision-log entry.
