<plan>
  <meta>
    <title>Projects — group tasks under an optional project</title>
    <status>completed</status>
  </meta>

  <context>
    <ref>docs/architecture.md#data-model</ref>
  </context>

  <targets>
    <file>server/db.ts</file>
    <file>server/index.ts</file>
    <file>web/src/api.ts</file>
    <file>web/src/TasksView.tsx</file>
    <file>docs/architecture.md</file>
    <file>docs/decision-log.md</file>
  </targets>

  <out-of-scope>
    Filtering/grouping TasksView by project.
    Per-project reporting in ReportsView.
    Showing the project in TodayView rows (MVP is TasksView only).
    Editing/reordering projects beyond create + rename + delete.
  </out-of-scope>

  <requirements>
    <req>A task without a project must behave exactly as today — project_id is nullable, no CHECK, default NULL.</req>
    <req>Deleting a project must not delete its tasks: ON DELETE SET NULL on tasks.project_id.</req>
    <req>Follow the existing nullable-column migration pattern in db.ts (PRAGMA table_info check + plain ALTER TABLE ADD COLUMN) — no CHECK constraint involved, so no table-rebuild dance is needed.</req>
    <req>Keep new timestamps in UTC text format "YYYY-MM-DD HH:MM:SS" (created_at on projects, via nowSQL()).</req>
    <req>Match the hand-rolled routing style in server/index.ts (segment matching, no framework) and the typed-fetch pattern in api.ts.</req>
  </requirements>
</plan>

# Implementation Phases

## Phase 1 — Schema
- [x] `db.ts`: `CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#64748b', created_at TEXT NOT NULL)`.
- [x] `db.ts`: migration — if `tasks` has no `project_id` column, `ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`.

## Phase 2 — API
- [x] `GET /api/projects` — list all, ordered by name.
- [x] `POST /api/projects` — `{ name, color? }`, name required/trimmed.
- [x] `PATCH /api/projects/:id` — rename / recolor.
- [x] `DELETE /api/projects/:id` — relies on `ON DELETE SET NULL`, no extra cleanup needed.
- [x] `POST /api/tasks` and `PATCH /api/tasks/:id` accept an optional `project_id` (validate it references an existing project, or is `null` to clear).
- [x] `listTasks` query / `GET /api/tasks` — either join project name+color onto each row, or ship `GET /api/projects` separately and let the client join client-side (prefer the latter — matches how `active` is a separate top-level field today, and avoids a join on the hot task-list query).

## Phase 3 — Frontend
- [x] `api.ts`: `Project` type, `project_id: number | null` on `Task`, `api.projects()/createProject()/updateProject()/removeProject()`, `project_id` added to the `create`/`update` payload types.
- [x] `TasksView.tsx`: a Project column next to Plan — a colored chip with the project name, or a "+ Project" picker (reuse the Plan column's inline-picker interaction) when unset; a lightweight "manage projects" affordance to create new ones inline (no separate settings page for v1).

## Verification
- [x] Ran `bun run dev`, created a project, assigned it to a task, cleared it back to none, deleted a project with tasks assigned and confirmed the tasks survive with no project.
- [x] Updated `docs/architecture.md` (Data-model + Frontend sections) — doc-sync.
- [x] Added a decision-log entry.
