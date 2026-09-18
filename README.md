# Zeitgeber
<img width="1022" height="472" alt="Screenshot 2026-05-28 at 13 00 34" src="https://github.com/user-attachments/assets/519d56a5-2ae1-44da-89b0-1022cfd53dc2" />

A local, self-hosted time tracker & to-do list. Plan your day, track time per
task with a live start/stop timer, group tasks into projects, and see how much
time you spend over a range of days or weeks.

Named after the [zeitgeber](https://en.wikipedia.org/wiki/Zeitgeber) — German for
"time giver", the external cue that entrains a circadian rhythm. Locked-in mode is
the cue: while it's on, it takes over the screen with the running task, and
reminds you every 5 minutes if no timer is running.

> The Docker service, container and nginx upstream are still named
> `activity-detector` — only the app's own name changed.

- **Runtime:** [Bun](https://bun.sh) — one process serves the REST API *and* the built frontend
- **Frontend:** React + Vite + Tailwind v4 + Recharts
- **Storage:** SQLite (`bun:sqlite`, no native deps) — a single file under `data/`
- **Deploy:** one Docker container

## Features

- **Today view** — a day planner: step between days, see planned vs. tracked vs.
  done at a glance, plan an existing (backlog) task onto a day or create one
  directly on it, and start/stop the live timer right from the row.
- **Table view** of all tasks with inline title editing, a status dropdown
  (`todo → doing → done`, plus a `recurring` status for daily/weekly tasks), a
  per-task note, a planned duration, and a **Plan** column to schedule a task
  onto a day.
- **Projects** — an optional colored label to group related tasks. Manage them
  (create / rename / delete, preset color swatches) inline from the table view;
  not having a project is the default and works everywhere.
- **Live timer** — click ▶ Start on a task; starting another auto-stops the first
  (only one task tracks at a time). Marking a task **done** stops the timer. Time
  entries can be edited or deleted after the fact.
- **Locked-in mode** — a full-screen takeover with the running task, a live
  clock and Stop, or a task picker when nothing's running; reminds you every
  5 minutes (OS notification + audio chime) if no timer is going.
- **Auto-stop when idle** — stops the timer after 15 minutes of system-wide
  idle or screen lock, backdating the stop to when inactivity began.
- **Reports** — a Today breakdown (hero total, recurring-vs-one-off split) plus
  an on-demand range (week / month / 3 months / 6 months / year) with a
  bucketed bar chart and per-task time breakdown, timestamped down to the entry.

## Run with Docker (recommended)

```bash
docker compose up --build -d
```

Open http://localhost:3001 . Your database lives in `./data/app.db` on the host
(mounted volume), so it survives container rebuilds.

## Run locally (dev, with hot reload)

Two terminals:

```bash
# terminal 1 — API on :3001 (auto-restarts on change)
bun run server

# terminal 2 — Vite dev server on :5173 (proxies /api to :3001)
bun --cwd web install   # first time only
bun run web
```

Open http://localhost:5173 .

## Run locally (production-style, single process)

```bash
bun run build      # build the frontend into web/dist
bun run start      # Bun serves API + web/dist on :3001
```

## Configuration

| Env var       | Default     | Purpose                          |
| ------------- | ----------- | -------------------------------- |
| `PORT`        | `3001`      | HTTP port                        |
| `DATA_DIR`    | `data`      | Directory for the SQLite file    |
| `STATIC_ROOT` | `web/dist`  | Built frontend to serve          |

## API

| Method & path                 | Description                                  |
| ------------------------------ | -------------------------------------------- |
| `GET /api/tasks`              | All tasks (with `total_seconds`) + active timer |
| `POST /api/tasks`             | Create `{ title, description?, recurrence?, duration_minutes?, planned_for?, project_id? }` |
| `PATCH /api/tasks/:id`        | Update `title` / `description` / `status` / `recurrence` / `duration_minutes` / `planned_for` / `project_id` / `archived` |
| `DELETE /api/tasks/:id`       | Delete a task (and its time entries)         |
| `POST /api/tasks/:id/start`   | Start tracking (auto-stops any running task) |
| `GET /api/tasks/:id/entries`  | Time entries for a task                      |
| `POST /api/tasks/:id/entries` | Add a manual entry `{ started_at, ended_at }` |
| `PATCH /api/entries/:id`      | Edit an entry's `started_at` / `ended_at`    |
| `DELETE /api/entries/:id`     | Delete a time entry                          |
| `GET /api/projects`           | All projects                                 |
| `POST /api/projects`          | Create `{ name, color? }`                    |
| `PATCH /api/projects/:id`     | Update `name` / `color`                      |
| `DELETE /api/projects/:id`    | Delete a project (its tasks keep existing, `project_id` cleared) |
| `POST /api/stop`              | Stop the running timer (optional `{ at }` to backdate) |
| `GET /api/report?from=&to=`   | Time entries (ISO UTC range), clipped to the range, for charts |

## Data model

- `tasks(id, title, description, status, recurrence, duration_minutes, planned_for, project_id, archived, created_at, updated_at)`
  — `status` ∈ `todo | doing | done | recurring`; `recurrence` ∈ `none | daily | weekly`
  (only meaningful when `status = recurring`); `planned_for` is a local day key
  `"YYYY-MM-DD"` (NULL = unplanned/backlog); `project_id` is a nullable FK to `projects`.
- `projects(id, name, color, created_at)` — an optional grouping label; deleting
  a project sets `project_id` to NULL on its tasks rather than deleting them.
- `time_entries(id, task_id, started_at, ended_at)` — `ended_at IS NULL` = running

Timestamps are stored as UTC (`YYYY-MM-DD HH:MM:SS`); the frontend renders and
buckets them in your local timezone.
