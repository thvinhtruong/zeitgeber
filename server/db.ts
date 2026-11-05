import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const DATA_DIR = process.env.DATA_DIR ?? "data";
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(`${DATA_DIR}/app.db`, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// A project groups tasks; a task without one is unaffected (project_id is
// nullable, no CHECK). Deleting a project un-links its tasks rather than
// deleting them — see the ON DELETE SET NULL below.
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#6366f1',
    created_at TEXT    NOT NULL
  );
`);

// The tasks schema. `status` includes 'recurring' (a task done on a daily/weekly
// cadence); `recurrence` is only meaningful when status = 'recurring'.
// `duration_minutes` is a planned/estimate duration (default 1h30m).
// `planned_for` is the LOCAL calendar day the task is planned for ("YYYY-MM-DD",
// NULL = unplanned/backlog) — a date, not a UTC timestamp.
// `project_id` is an optional grouping (NULL = no project).
// `completed_at` is the UTC time the task last became 'done' (NULL otherwise).
const TASKS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT    NOT NULL,
    description      TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','recurring')),
    recurrence       TEXT    NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly')),
    duration_minutes INTEGER NOT NULL DEFAULT 90,
    planned_for      TEXT,
    completed_at     TEXT,
    project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    archived         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
  );
`;

db.exec(TASKS_SCHEMA);

db.exec(`
  CREATE TABLE IF NOT EXISTS time_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at TEXT    NOT NULL,
    ended_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entries_task    ON time_entries(task_id);
  CREATE INDEX IF NOT EXISTS idx_entries_started ON time_entries(started_at);
`);

// A goal is independent of tasks/timers. `target_date` is a LOCAL day key like
// tasks.planned_for. `assessment` is the AI's S.M.A.R.T review as JSON text
// (NULL = not assessed yet); `smart_score` (0-100) is copied out of it so the
// list can sort/colour without parsing.
db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    details     TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'job' CHECK (category IN ('health','job','study')),
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','dropped')),
    target_date TEXT,
    assessment  TEXT,
    smart_score INTEGER,
    assessed_at TEXT,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );
`);

// ---- migration for pre-existing DBs ----
// Older DBs have a tasks table without `recurrence` / `duration_minutes` and a
// status CHECK that forbids 'recurring'. SQLite can't ALTER a CHECK constraint,
// so rebuild the table. Detect by looking for 'recurring' in the stored DDL.
const tasksDDL =
  (db.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`).get() as
    | { sql: string }
    | null)?.sql ?? "";

if (tasksDDL && !tasksDDL.includes("recurring")) {
  // legacy_alter_table=ON keeps the RENAME "dumb" so time_entries' FK text stays
  // pointing at "tasks"; foreign_keys=OFF avoids cascade churn during the copy.
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("PRAGMA legacy_alter_table = ON;");
  db.transaction(() => {
    db.exec("ALTER TABLE tasks RENAME TO tasks_old;");
    db.exec(TASKS_SCHEMA);
    db.exec(`
      INSERT INTO tasks (id, title, description, status, archived, created_at, updated_at)
      SELECT id, title, description, status, archived, created_at, updated_at FROM tasks_old;
    `);
    db.exec("DROP TABLE tasks_old;");
  })();
  db.exec("PRAGMA legacy_alter_table = OFF;");
  db.exec("PRAGMA foreign_keys = ON;");
}

// `planned_for` is nullable with no CHECK, so a plain ADD COLUMN is enough.
const taskCols = db
  .query(`PRAGMA table_info(tasks)`)
  .all() as { name: string }[];

if (!taskCols.some((c) => c.name === "planned_for")) {
  db.exec("ALTER TABLE tasks ADD COLUMN planned_for TEXT;");
}

if (!taskCols.some((c) => c.name === "project_id")) {
  db.exec("ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;");
}

// `completed_at` (UTC) — nullable, so plain ADD COLUMN; backfill tasks that were
// already done with their last update time, the best record we have.
if (!taskCols.some((c) => c.name === "completed_at")) {
  db.exec("ALTER TABLE tasks ADD COLUMN completed_at TEXT;");
  db.exec("UPDATE tasks SET completed_at = updated_at WHERE status = 'done';");
}
