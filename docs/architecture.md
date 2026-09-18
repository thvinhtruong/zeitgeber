# Architecture

> Read this for **every** task — it's the always-on backbone. Jump to the section your task type points at (see `CLAUDE.md` `<context-routing>`).

> **Name.** The app is **Zeitgeber** (German "time giver" — the external cue that entrains a
> circadian rhythm; focus mode is that cue). The repo folder, the compose service, the
> `container_name`, and the nginx upstream are all still `activity-detector` — deliberately, so
> the running deployment and the git remote kept working. Don't "fix" that inconsistency in
> passing; renaming the compose service needs `--remove-orphans` or the old container keeps
> port 3001.

## Product & domain

A local, self-hosted **time tracker + to-do list**. You create tasks, start a timer on one, and later view reports of where time went. Single-user, no auth.

Core nouns:

- **Task** — a to-do item with `status` ∈ `todo | doing | done | recurring` (CHECK-constrained in the schema), a `recurrence` ∈ `none | daily | weekly` (only meaningful when status = `recurring`), a `duration_minutes` planned/estimate duration (default 90 = 1h30m, editable inline in the table; display-only, no timer interaction), a nullable `planned_for` day (below), and a nullable `project_id` (below).
- **Project** — an optional grouping label (`name` + `color`) a task can belong to. Not having one is the default and fully supported everywhere — same posture as `planned_for`. Deleting a project un-links its tasks (`ON DELETE SET NULL`) rather than deleting them.
- **Day plan** ("task of the day") — the set of tasks to do on one calendar day. A task carries `planned_for`, a **local** day key `"YYYY-MM-DD"` (NULL = unplanned/backlog); a task has at most one planned day, so re-planning moves it. Recurring tasks are **derived** into a day's plan instead of being stored: `daily` appears on every day, `weekly` on the weekday of its `created_at` (local). They never get a `planned_for` value, and can't be dismissed from an individual day.
- **TimeEntry** — a row in `time_entries` with `started_at` and a nullable `ended_at`. An entry with `ended_at IS NULL` is the **active timer**.
- **Active timer** — there is at most **one** open `time_entry` across the whole DB at any moment.
- **Duration** — never stored; computed in SQL as `julianday(ended_at) - julianday(started_at)` (×86400 for seconds).
- **Report** — durations aggregated over a requested date range, clipping entries to the range and treating a still-running entry's end as "now".

## Stack overview

| Layer | Tech |
| --- | --- |
| Runtime | Bun (one process serves API + static frontend) |
| Backend | `Bun.serve`, hand-rolled path routing, `bun:sqlite` |
| Frontend | React 18, Vite, Tailwind v4 (`@tailwindcss/vite`, no config file), Recharts |
| Storage | Single SQLite file (`app.db`), WAL mode, foreign keys on |
| Deploy | Docker compose: app container + `nginx:alpine` reverse proxy on :80, DB persisted to a host volume |

No test framework, no linter, no migration tool, no CI.

## Boundaries & how they talk

```
web/src (React, :5173 dev)  --HTTP /api/*-->  server/index.ts (Bun.serve, :3001)  -->  bun:sqlite (data/app.db)
```

- **Dev:** Vite (`:5173`) proxies `/api` to the Bun server (`:3001`). Two processes.
- **Prod:** one Bun process serves `web/dist` static files AND `/api/*` on `:3001`.
- The only contract between frontend and backend is the JSON REST API under `/api/*`; shared TypeScript types live in `web/src/api.ts` (`Task`, `Active`, `ReportEntry`).

## Backend — `server/` (two files)

- **`db.ts`** — opens/creates the SQLite DB, sets WAL + foreign keys, runs the `CREATE TABLE IF NOT EXISTS` schema **inline**. This *is* the migration system; there are no migration files — edit the schema here. Changing columns on an existing `data/app.db` requires manual migration.
- **`index.ts`** — a single `Bun.serve` handler. `/api/*` routes through `handleApi` (path matching on `pathname` segments, **no framework/router**); everything else falls through to `serveStatic`, which serves `web/dist` and falls back to `index.html` for SPA routing.

### Timer logic (must preserve)

- `POST /api/tasks/:id/start` runs in a transaction: `stopRunning` (close any open entry) → insert new `time_entry` → set task `status = 'doing'`.
- Marking a task `done` (PATCH) stops the running timer.
- Reports clip entries to the requested range; in-progress entries count up to "now". Each row carries the task's `title`, `status` **and `recurrence`** so the client can split recurring from one-off work.

## Frontend — `web/src/`

- `App.tsx` — thin: wraps `AppBody` in `TrackingProvider` and nothing else.
- `AppBody.tsx` — owns the tab shell (`TodayView` default, `TasksView`, `ReportsView`) **and** the two session-flag hooks (`useLockedIn`, `useIdleAutoStop`). It renders either the normal header+nav+main shell (passing the hook state down to `TrackingStatus` as props) or, while locked-in mode is on, `LockedInView` full-screen in its place. The hooks are mounted here — one level above the shell swap — specifically so the reminder clock, `document.title`, and the idle watcher keep running no matter which shell is showing; mounting them inside the swapped-out component would silently kill them on entering locked-in mode.
- `tracking.tsx` — `TrackingProvider` / `useTracking`: the app-wide view of `{ tasks, active }` that the header pill needs on every tab. Views `publish()` what they just fetched (instant) and the provider also polls `/api/tasks` every 20s as a fallback for tabs that don't fetch (Reports). `version` is the reverse channel — `invalidate()` bumps it to ask every view to re-read, which is how an idle auto-stop triggered from the header reaches the views.
- `TrackingStatus.tsx` — purely presentational: the two session flags as identical always-visible switch chips (`FlagChip`) in the header, taking `lockedIn`/`idle`/`error` as props from `AppBody` rather than mounting the hooks itself. There is no status badge/popover, because the running task's title, live clock and stop button already live on its row in `TodayView` and a header copy only competed with them. A flag's `notice` (permission denied, auto-stopped, or a failed stop) rides its chip as an amber ring + `title` tooltip; a `sr-only` live region announces an overdue reminder.
- `useLockedIn.ts` / `useIdleAutoStop.ts` — the two session flags; see below.
- `LockedInView.tsx` — the full-screen takeover rendered by `AppBody` while locked-in mode is on, in place of the tab shell (no header, no nav to other tasks). Two states: **tracking** (task title, a live clock, Stop) and **not tracking** — a real state here, not just a transition, so it's a minimal filterable picker over open tasks rather than stranding the user with nothing to click. A small always-visible "🔓 Exit" button in the corner flips the flag off — same instant stop-and-return as the header chip, no confirmation step.
- `TodayView.tsx` — the day planner: date stepper (◀ / ▶ / date input / "Jump to today"), planned-vs-tracked-vs-done header, one row per planned task (done checkbox, recurring badge, planned duration, tracked-today with a live clock for the running task, start/stop, ✕ to unplan), a title input that creates a task already planned for the shown day, and backlog chips that plan an existing task onto it. Per-day tracked time comes from `api.report(dayStart, dayNextStart)` summed per `task_id`; because the report counts a running entry up to fetch time, the active task's figure is topped up with `now - fetchedAt`.
- `ReportsView.tsx` — two halves fed by **one** `/api/report` call (every range ends today, so the Today half just clips the same entries to local midnight). Only the first half is on screen by default; `rangeKey === null` is the default state and means "today only" — it fetches today's window alone, and picking a range reveals the second half (`✕ Hide` returns to today-only):
  - **Today** — hero total for the current local day, the recurring / one-off split as a 100%-stacked meter, and per-task rows.
  - **Range** (`Week | Month | 3 months | 6 months | Year`, on demand) — a stacked bar chart bucketed automatically from the range (day → week → month; every bucket in the range gets a column, empty ones included, so a week off doesn't stretch the time axis), plus per-task totals as **horizontal rows** (bar under the title) split into `One-off tasks` / `Recurring tasks` groups, capped at `TOP_N` with a "show more" expander. Row bars share one scale (the largest task in the report) so lengths stay comparable across the two groups.
  - Recurring vs one-off comes from the entry's **`recurrence`**, not its `status` — a recurring task ticked off for the day has `status = 'done'`. Its two colours are categorical slots 1 (blue `#2a78d6`) and 2 (orange `#eb6834`); they follow the kind of task, never its rank.
- `TasksView.tsx` — the full list; its **Plan** column shows `every day/week` for recurring tasks, a `+ Today` button when unplanned, or a date input + ✕ to move/clear `planned_for`. Its **Project** column is a `<select>` chip (colored by the project when set, muted "No project" when not) next to Plan; a collapsible "Manage projects" panel above the table does inline create (name + preset color swatch) / rename / delete — no separate settings page. Not having a project is the unremarkable default, same as an unplanned task.
- `api.ts` — typed fetch wrapper **and** the source of shared types. Add new API calls + types here.
- `format.ts` — time/date display helpers.
- Tailwind v4 has **no config file**; use utility classes inline. Charts via Recharts.

### The two session flags (`useLockedIn.ts`, `useIdleAutoStop.ts`)

Two opt-in, client-only flags (no server state, no schema) that both live in the header as a matched pair of always-visible switch chips:

| Flag | localStorage | Behaviour |
| --- | --- | --- |
| **Locked in** | `ad-locked-in` (`"1"`/`"0"`) | Replaces the tab shell with `LockedInView`'s full-screen takeover (§ Frontend). While on and **no** timer is running, also reminds every 5 min. Switching it **off** stops the running timer and returns to the normal shell. |
| **Auto-stop when idle** | `ad-autostop` (`"1"`/`"0"`) | Stops the timer after 15 min of system-wide idle / screen lock, backdating the stop to when inactivity began. |

They are two halves of "keep my tracking honest" and are designed together: auto-stop closes a timer you forgot to stop, locked-in mode chases a timer you forgot to start.

**Presence is declared, not detected.** Locked-in mode has no idle detection of its own — while it is on you are asserting that you intend to be tracking, so any untracked stretch earns a reminder. Finishing work means switching it off, which also stops whatever is running, so "stop nagging me" and "I'm done for now" are deliberately the same action — this is also why the takeover's exit button has no confirmation step. (This replaced an earlier design that gated reminders on the Idle Detection API; the manual switch is simpler and doesn't depend on a Chrome-only permission. The flag itself was originally called "focus mode" / `ad-focus`; the rename to "locked in" tracks the takeover view added alongside it — reminder logic is unchanged.)

- **Cadence** is fixed: reminders at 5, 10, 15… minutes untracked (`NUDGE_EVERY_MS`), counted from when the timer stopped or when locked-in mode was switched on.
- **Channels**: an OS `Notification` (tagged `ad-locked-in`, so a new reminder replaces the previous one rather than stacking, `silent: true` since the audio chime covers that), `document.title` — `● <task>` while tracking, `⏸ Not tracking` once the first reminder is due — and a two-beep Web Audio chime, so a reminder is audible even with the tab backgrounded or notifications denied. The chime's `AudioContext` is created/resumed on the switch-on click (the only user gesture in the flow), not lazily inside the reminder tick, to satisfy browser autoplay policy. The header pill also reflects state, but it's ambient status rather than a notification channel.
- **Notification permission** is requested on the switch gesture, never on mount, and is deliberately **not awaited** — an ignored prompt would otherwise leave the switch looking dead. Everything except the OS notification (including the chime) works without it.
- Elapsed time is always a `Date.now()` delta, never a count of `setInterval` ticks — a hidden tab throttles the 15s tick to roughly once a minute.
- Only the OS notification depends on browser permission; the Idle Detection API (Chrome/Edge, separate permission) is needed **only** by auto-stop, which disables itself with an explanatory message where it isn't available.

## Data model

- `tasks` — `id`, `status` (`todo|doing|done|recurring`), `recurrence` (`none|daily|weekly`), `duration_minutes` (INTEGER, default 90), `planned_for` (TEXT, nullable, local day key `"YYYY-MM-DD"` — **not** a UTC timestamp), `project_id` (INTEGER, nullable FK → `projects.id`, `ON DELETE SET NULL`), plus title/timestamps. `status` and `recurrence` are CHECK-constrained; `planned_for` is validated in `index.ts` (`isDayKey`) rather than by the schema; `project_id` is validated by checking it references an existing row.
  - **Migration note:** `planned_for` and `project_id` are nullable with no CHECK, so `db.ts` adds them to old DBs with a plain `ALTER TABLE … ADD COLUMN` guarded by a `PRAGMA table_info(tasks)` check.
  - **Migration note:** because SQLite can't ALTER a CHECK constraint, `db.ts` detects a pre-`recurring` tasks table (by scanning its stored DDL) and rebuilds it (rename → recreate → copy → drop) under `legacy_alter_table=ON` + `foreign_keys=OFF` so `time_entries`' FK text keeps pointing at `tasks`. This runs once per old DB; fresh DBs skip it.
- `projects` — `id`, `name`, `color` (hex string, default `#6366f1`), `created_at`. No CHECK, no status — a flat label table. `server/index.ts` exposes `GET/POST /api/projects` and `PATCH/DELETE /api/projects/:id`; the task list does **not** join project data server-side (`GET /api/tasks` ships bare `project_id`), the client joins against a separately-fetched `GET /api/projects` — keeps the hot task-list query un-joined.
- `time_entries` — `id`, `task_id` (FK), `started_at`, `ended_at` (nullable; NULL = active).
- All timestamps are stored as **UTC text** (see below). `total_seconds` and report figures are computed, not columns.

## Timezone convention (easy to get wrong)

All timestamps are stored as **UTC** in the SQLite text format `"YYYY-MM-DD HH:MM:SS"` (produced by `nowSQL()` on the server). The frontend sends ISO UTC strings and uses `parseUTC()` (in `api.ts`) to convert to `Date`; all local rendering and per-day/per-week bucketing happens client-side in the browser's local timezone. Keep new timestamps in this exact UTC text format.

## Configuration (env vars)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `DATA_DIR` | `data` | Directory holding `app.db` (Docker uses `/data`, a mounted volume) |
| `STATIC_ROOT` | `web/dist` | Built frontend to serve |

## Deploy

`docker compose up --build -d` builds the frontend and runs the single Bun process; the SQLite DB persists in `./data` on the host. `bun run start` is the non-Docker equivalent and requires a prior `bun run build` (else it serves a "frontend not built" message).

### Local vanity domain (`http://vinhtruong.localhost`)

A second compose service, `nginx` (`nginx:alpine`), listens on host port **80** and reverse-proxies to `activity-detector:3001` over the compose network — no host `nginx` install and no `sudo` needed, since Docker Desktop binds privileged ports itself. Config lives in `nginx/`, mounted read-only into `/etc/nginx/conf.d/`:

| File | Purpose |
| --- | --- |
| `nginx/vinhtruong.localhost.conf` | Two blocks on :80 — a `default_server` catch-all (`server_name _`) that `return 444`s unrecognised Host headers, and the real proxy block for `vinhtruong.localhost localhost 127.0.0.1` with `X-Forwarded-*` headers, buffering off (SSE-safe), 3600s read timeout |
| `nginx/00-upgrade-map.conf` | `map $http_upgrade $connection_upgrade` for WebSocket upgrades; `00-` prefix loads it before the server block |

macOS and Chrome already resolve any `*.localhost` name to loopback (RFC 6761), so **no `/etc/hosts` entry is needed**. On a platform whose resolver doesn't, add one line (IP only — `/etc/hosts` does not accept ports):

```
127.0.0.1 vinhtruong.localhost
```

Port 3001 stays published, so `http://localhost:3001` keeps working alongside the vanity URL.

The catch-all exists because a lone `server` block is implicitly the default and would answer to **any** Host header — including retired names. Reaching the app under a new hostname now requires adding it to `server_name`, so old names stop working the moment they leave that list.

**The `.localhost` suffix is load-bearing, not cosmetic.** Idle auto-stop (`IdleDetector`) and focus-mode notifications (`Notification.requestPermission`) are gated on a *secure context*, which Chrome grants only to HTTPS origins plus `localhost`, `127.0.0.1`, and any `*.localhost` name. A plain-HTTP vanity host on a made-up TLD is an insecure origin, so `window.IdleDetector` is undefined there and auto-stop silently disables itself. Keeping the name under `.localhost` buys a secure context with no TLS certificate. Any future rename must stay under `.localhost` or move the proxy to HTTPS.
