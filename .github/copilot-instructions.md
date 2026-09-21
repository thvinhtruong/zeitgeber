# Copilot instructions for Zeitgeber

## Commands

Run commands from the repository root with Bun installed.

```bash
PORT=3001 bun run server  # Bun API on :3001 in watch mode
bun run web          # Vite frontend on :5173; /api is proxied to :3001
bun run dev          # Runs the Vite and Bun servers together
bun run build        # Installs web dependencies and builds web/dist
bun run start        # Serves the API and an existing web/dist from one process
docker compose up --build -d
```

There is no configured test framework, linter, CI, or single-test command. Verify changes manually through the running app and its REST API. `bun run build` is the available frontend compilation check. The Docker deployment persists the SQLite database in `./data`; do not commit that directory.

## Architecture

Zeitgeber is a single-user, self-hosted time tracker and task planner. In development, Vite serves `web/src` on port 5173 and proxies `/api/*` to the Bun server on port 3001. In production, `server/index.ts` serves both the REST API and the built `web/dist` SPA from one `Bun.serve` process. Docker builds the React frontend in a Bun build stage and runs the server with SQLite data mounted at `/data`.

- `server/index.ts` is the hand-written API router and handler layer. It parses URL path segments directly; do not introduce a framework router for one-off endpoints.
- `server/db.ts` opens `data/app.db`, enables WAL and foreign keys, and contains the inline `CREATE TABLE IF NOT EXISTS` schema. This file is also the migration mechanism; existing databases need explicit compatibility handling when columns or constraints change.
- `web/src/api.ts` is the typed boundary for all frontend API calls and shared domain types (`Task`, `Project`, `Active`, `TimeEntry`, and `ReportEntry`). Add new API methods and types there rather than scattering raw `fetch` calls through views.
- `AppBody` owns the tab shell and session-level locked-in/idle-auto-stop hooks. `TrackingProvider` publishes the current tasks/active timer across views and provides invalidation for cross-view refreshes. `TodayView`, `TasksView`, and `ReportsView` implement the planner, task/project table, and time reports respectively.
- Tailwind v4 is used through the Vite plugin with utility classes inline; there is no Tailwind config file. Recharts supplies report charts.

## Domain and data conventions

- There is globally at most one active timer: a `time_entries` row with `ended_at IS NULL`. Starting a task must run `stopRunning`, insert the new entry, and update the task status in one transaction. Marking a task `done` stops the active timer.
- Durations are derived in SQL with `julianday(...)`; do not add stored duration columns or duplicate duration calculations in the database.
- Reports accept an ISO UTC range, clip entries to that range, and treat an open entry's end as the current time. Recurring-vs-one-off reporting is based on `recurrence`, not the task's current `status`.
- Store timestamps as UTC SQLite text in `YYYY-MM-DD HH:MM:SS`, using the server's `nowSQL()` convention. The frontend converts with `parseUTC()` and performs local-time rendering and day/week bucketing in the browser.
- `planned_for` is a local calendar key (`YYYY-MM-DD`), not a timestamp. `NULL` means backlog. Recurring daily/weekly tasks are derived into day plans and do not receive a `planned_for` value.
- `project_id` is nullable. Deleting a project must leave its tasks intact and clear the relationship via `ON DELETE SET NULL`.
- Keep the app's current API shape and error style: JSON responses, `{ error: ... }` for bad requests, and explicit validation for task status, recurrence, day keys, project references, and timestamp ordering.
- `PORT`, `DATA_DIR`, and `STATIC_ROOT` are environment-configurable. Docker sets `PORT=3001`, `DATA_DIR=/data`, and serves `web/dist`; the server source fallback port is 3000 when `PORT` is unset.

## Repository workflow

Before implementing work, skim `docs/backlogs/plans/` and use the relevant existing plan; larger features need a plan under `docs/backlogs/plans/{YYMMDD-slug}/plan.md`. Keep durable architecture notes in `docs/architecture.md` and major architectural decisions in `docs/decision-log.md`.

After changing `server/`, update the corresponding backend/data-model documentation in `docs/architecture.md`; after changing `web/src/`, update its frontend section. Schema changes require reviewing both the inline schema and compatibility logic in `server/db.ts`. Preserve the existing TypeScript/ES-module style, hand-rolled server patterns, and typed-fetch frontend pattern. Do not create parallel `*-enhanced` or `*-v2` files, commit secrets or `data/`, or make unrelated cleanup changes.
