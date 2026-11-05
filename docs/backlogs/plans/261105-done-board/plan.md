<plan>
  <meta>
    <title>Done board: completed tasks + metrics on Today and Tasks</title>
    <status>completed</status>
  </meta>
  <context>
    <ref>docs/decision-log.md#2026-11-05-done-board--completed_at</ref>
  </context>
  <targets>
    <file>server/db.ts</file>
    <file>server/index.ts</file>
    <file>web/src/api.ts</file>
    <file>web/src/DoneBoard.tsx</file>
    <file>web/src/TodayView.tsx</file>
    <file>web/src/TasksView.tsx</file>
  </targets>
  <out-of-scope>
    <item>Per-day completion history for recurring tasks (status is still a single manual badge).</item>
  </out-of-scope>
  <requirements>
    <req>completed_at is UTC text "YYYY-MM-DD HH:MM:SS"; bucketing into local days happens client-side.</req>
    <req>Marking done still stops the running timer.</req>
  </requirements>
</plan>
