<plan>
  <meta>
    <title>S.M.A.R.T goals with AI assessment</title>
    <status>completed</status> <!-- not_started | in_progress | completed -->
  </meta>

  <context>
    <ref>docs/decision-log.md#2026-10-18--smart-goals--ai-assessment</ref>
  </context>

  <targets>
    <file>server/db.ts</file>
    <file>server/index.ts</file>
    <file>server/smart.ts</file>
    <file>package.json</file>
    <file>Dockerfile</file>
    <file>docker-compose.yml</file>
    <file>web/src/api.ts</file>
    <file>web/src/AppBody.tsx</file>
    <file>web/src/GoalsView.tsx</file>
  </targets>

  <out-of-scope>
    <item>Linking goals to tasks / tracked time (possible follow-up).</item>
    <item>User-defined categories — fixed set health | job | study for now.</item>
    <item>Progress tracking / milestones inside a goal.</item>
  </out-of-scope>

  <requirements>
    <req>Goals are independent of tasks and timers — the one-timer invariant is untouched.</req>
    <req>Assessment runs server-side (the API key never reaches the browser) and is stored on the goal, so the list renders without re-calling the model.</req>
    <req>The app keeps working without an API key: goals CRUD works, assess returns a clear error.</req>
    <req>Timestamps in UTC text; target_date is a local day key like tasks.planned_for.</req>
  </requirements>
</plan>

# Implementation Phases

## Phase 1 — Backend
- [x] `goals` table in `db.ts` (category / status CHECK-constrained; assessment JSON + score columns)
- [x] `server/smart.ts`: Claude call with structured JSON output → per-letter 1–5 scores, feedback, summary, rewrite suggestion
- [x] `GET/POST /api/goals`, `PATCH/DELETE /api/goals/:id`, `POST /api/goals/:id/assess`
- [x] `@anthropic-ai/sdk` as a root dependency; Dockerfile installs root deps; compose passes `ANTHROPIC_API_KEY`

## Phase 2 — Frontend
- [x] `Goal` / `SmartAssessment` types + calls in `api.ts`
- [x] `GoalsView.tsx`: create form, category filter, list grouped by category, score pill, expandable S/M/A/R/T breakdown, "use suggestion", re-assess, achieved/dropped, delete
- [x] "goals" tab in `AppBody.tsx`

## Verification
- [x] Ran the server and exercised CRUD + assess via curl; ran the web build.
- [x] Updated `docs/architecture.md` (Domain, Backend, Frontend, Data model, Config).
- [x] Added a decision-log entry.
