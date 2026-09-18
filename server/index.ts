import { db } from "./db";

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_ROOT = process.env.STATIC_ROOT ?? "web/dist";

// SQLite-friendly UTC timestamp: "YYYY-MM-DD HH:MM:SS"
const nowSQL = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const bad = (msg: string, status = 400) => json({ error: msg }, status);

const STATUSES = ["todo", "doing", "done", "recurring"];
const RECURRENCES = ["none", "daily", "weekly"];

// A local calendar day key, "YYYY-MM-DD" (used by tasks.planned_for).
const isDayKey = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const listProjects = db.query(`SELECT * FROM projects ORDER BY name`);
const getProject = db.query(`SELECT id FROM projects WHERE id = ?`);

// ---------- queries ----------
const SECONDS = "(julianday(e.ended_at) - julianday(e.started_at)) * 86400";

const listTasks = db.query(`
  SELECT t.*,
    COALESCE((SELECT SUM(${SECONDS}) FROM time_entries e
              WHERE e.task_id = t.id AND e.ended_at IS NOT NULL), 0) AS total_seconds
  FROM tasks t
  WHERE t.archived = 0
  ORDER BY CASE t.status
             WHEN 'recurring' THEN 0
             WHEN 'doing'     THEN 1
             WHEN 'todo'      THEN 2
             ELSE 3
           END,
           t.updated_at DESC
`);

const getActive = db.query(
  `SELECT id, task_id, started_at FROM time_entries WHERE ended_at IS NULL LIMIT 1`,
);

const stopRunning = db.prepare(
  `UPDATE time_entries SET ended_at = ? WHERE ended_at IS NULL`,
);

const listEntries = db.query(`
  SELECT e.id, e.task_id, e.started_at, e.ended_at,
         CASE WHEN e.ended_at IS NULL THEN NULL ELSE ${SECONDS} END AS seconds
  FROM time_entries e
  WHERE e.task_id = ?
  ORDER BY e.started_at DESC
`);

// Accepts an ISO string (or SQLite UTC text) and normalizes to "YYYY-MM-DD HH:MM:SS".
// Returns null if it isn't a valid timestamp.
function toSQLts(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// ---------- handlers ----------
function handleApi(req: Request, url: URL): Response {
  const { pathname } = url;
  const seg = pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  // GET /api/tasks
  if (pathname === "/api/tasks" && method === "GET") {
    const tasks = listTasks.all();
    const active = getActive.get() as { task_id: number; started_at: string } | null;
    return json({ tasks, active });
  }

  // POST /api/tasks
  if (pathname === "/api/tasks" && method === "POST") {
    return req.json().then((body: any) => {
      const title = String(body?.title ?? "").trim();
      if (!title) return bad("title is required");
      const status = STATUSES.includes(body?.status) ? body.status : "todo";
      const recurrence = RECURRENCES.includes(body?.recurrence) ? body.recurrence : "none";
      const duration = Number.isFinite(body?.duration_minutes)
        ? Math.max(0, Math.round(body.duration_minutes))
        : 90;
      const planned_for = isDayKey(body?.planned_for) ? body.planned_for : null;
      let project_id: number | null = null;
      if (body?.project_id != null) {
        const pid = Number(body.project_id);
        if (!Number.isInteger(pid) || !getProject.get(pid)) return bad("project not found");
        project_id = pid;
      }
      const now = nowSQL();
      const row = db
        .query(
          `INSERT INTO tasks (title, description, status, recurrence, duration_minutes, planned_for, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(
          title,
          String(body?.description ?? ""),
          status,
          recurrence,
          duration,
          planned_for,
          project_id,
          now,
          now,
        );
      return json(row, 201);
    }) as unknown as Response;
  }

  // /api/tasks/:id ...
  if (seg[0] === "api" && seg[1] === "tasks" && seg[2]) {
    const id = Number(seg[2]);
    if (!Number.isInteger(id)) return bad("invalid id");
    const exists = db.query(`SELECT id FROM tasks WHERE id = ?`).get(id);
    if (!exists) return bad("task not found", 404);

    // PATCH /api/tasks/:id
    if (!seg[3] && method === "PATCH") {
      return req.json().then((body: any) => {
        const fields: string[] = [];
        const vals: any[] = [];
        if (typeof body.title === "string") {
          fields.push("title = ?");
          vals.push(body.title.trim());
        }
        if (typeof body.description === "string") {
          fields.push("description = ?");
          vals.push(body.description);
        }
        if (STATUSES.includes(body.status)) {
          fields.push("status = ?");
          vals.push(body.status);
          // stop tracking when a task is finished
          if (body.status === "done") stopRunning.run(nowSQL());
        }
        if (RECURRENCES.includes(body.recurrence)) {
          fields.push("recurrence = ?");
          vals.push(body.recurrence);
        }
        if (Number.isFinite(body.duration_minutes)) {
          fields.push("duration_minutes = ?");
          vals.push(Math.max(0, Math.round(body.duration_minutes)));
        }
        // planned_for: a day key plans the task for that day, null unplans it
        if (body.planned_for === null || isDayKey(body.planned_for)) {
          fields.push("planned_for = ?");
          vals.push(body.planned_for);
        }
        // project_id: null clears it, a number must reference an existing project
        if (body.project_id === null) {
          fields.push("project_id = ?");
          vals.push(null);
        } else if (body.project_id !== undefined) {
          const pid = Number(body.project_id);
          if (!Number.isInteger(pid) || !getProject.get(pid)) return bad("project not found");
          fields.push("project_id = ?");
          vals.push(pid);
        }
        if (typeof body.archived === "boolean") {
          fields.push("archived = ?");
          vals.push(body.archived ? 1 : 0);
        }
        if (!fields.length) return bad("nothing to update");
        fields.push("updated_at = ?");
        vals.push(nowSQL(), id);
        const row = db
          .query(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
          .get(...vals);
        return json(row);
      }) as unknown as Response;
    }

    // DELETE /api/tasks/:id
    if (!seg[3] && method === "DELETE") {
      db.query(`DELETE FROM tasks WHERE id = ?`).run(id);
      return json({ ok: true });
    }

    // GET /api/tasks/:id/entries
    if (seg[3] === "entries" && !seg[4] && method === "GET") {
      return json({ entries: listEntries.all(id) });
    }

    // POST /api/tasks/:id/entries  (manual entry; both timestamps required)
    if (seg[3] === "entries" && !seg[4] && method === "POST") {
      return req.json().then((body: any) => {
        const started_at = toSQLts(body?.started_at);
        const ended_at = toSQLts(body?.ended_at);
        if (!started_at || !ended_at) return bad("started_at and ended_at are required");
        if (ended_at < started_at) return bad("ended_at must be after started_at");
        const row = db
          .query(
            `INSERT INTO time_entries (task_id, started_at, ended_at)
             VALUES (?, ?, ?) RETURNING id, task_id, started_at, ended_at`,
          )
          .get(id, started_at, ended_at);
        return json(row, 201);
      }) as unknown as Response;
    }

    // POST /api/tasks/:id/start
    if (seg[3] === "start" && method === "POST") {
      const now = nowSQL();
      const tx = db.transaction(() => {
        stopRunning.run(now);
        db.query(
          `INSERT INTO time_entries (task_id, started_at) VALUES (?, ?)`,
        ).run(id, now);
        db.query(
          `UPDATE tasks SET status = CASE WHEN status = 'recurring' THEN 'recurring' ELSE 'doing' END,
                            updated_at = ? WHERE id = ?`,
        ).run(now, id);
      });
      tx();
      return json({ ok: true, task_id: id, started_at: now });
    }
  }

  // GET /api/projects
  if (pathname === "/api/projects" && method === "GET") {
    return json({ projects: listProjects.all() });
  }

  // POST /api/projects
  if (pathname === "/api/projects" && method === "POST") {
    return req.json().then((body: any) => {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");
      const color = typeof body?.color === "string" && body.color.trim() ? body.color.trim() : "#6366f1";
      const row = db
        .query(`INSERT INTO projects (name, color, created_at) VALUES (?, ?, ?) RETURNING *`)
        .get(name, color, nowSQL());
      return json(row, 201);
    }) as unknown as Response;
  }

  // /api/projects/:id
  if (seg[0] === "api" && seg[1] === "projects" && seg[2] && !seg[3]) {
    const pid = Number(seg[2]);
    if (!Number.isInteger(pid)) return bad("invalid id");
    if (!getProject.get(pid)) return bad("project not found", 404);

    // PATCH /api/projects/:id
    if (method === "PATCH") {
      return req.json().then((body: any) => {
        const fields: string[] = [];
        const vals: any[] = [];
        if (typeof body.name === "string") {
          const name = body.name.trim();
          if (!name) return bad("name cannot be empty");
          fields.push("name = ?");
          vals.push(name);
        }
        if (typeof body.color === "string" && body.color.trim()) {
          fields.push("color = ?");
          vals.push(body.color.trim());
        }
        if (!fields.length) return bad("nothing to update");
        vals.push(pid);
        const row = db.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ? RETURNING *`).get(...vals);
        return json(row);
      }) as unknown as Response;
    }

    // DELETE /api/projects/:id  (tasks keep existing via ON DELETE SET NULL)
    if (method === "DELETE") {
      db.query(`DELETE FROM projects WHERE id = ?`).run(pid);
      return json({ ok: true });
    }
  }

  // /api/entries/:id  (edit / delete a single time entry)
  if (seg[0] === "api" && seg[1] === "entries" && seg[2] && !seg[3]) {
    const eid = Number(seg[2]);
    if (!Number.isInteger(eid)) return bad("invalid id");
    const entry = db
      .query(`SELECT id, started_at, ended_at FROM time_entries WHERE id = ?`)
      .get(eid) as { started_at: string; ended_at: string | null } | null;
    if (!entry) return bad("entry not found", 404);

    if (method === "PATCH") {
      return req.json().then((body: any) => {
        let started_at = entry.started_at;
        let ended_at = entry.ended_at;
        if (body.started_at !== undefined) {
          const v = toSQLts(body.started_at);
          if (!v) return bad("invalid started_at");
          started_at = v;
        }
        if (body.ended_at !== undefined) {
          // allow clearing ended_at only if no other timer is running
          if (body.ended_at === null) {
            const running = getActive.get() as { id: number } | null;
            if (running && running.id !== eid)
              return bad("another timer is already running");
            ended_at = null;
          } else {
            const v = toSQLts(body.ended_at);
            if (!v) return bad("invalid ended_at");
            ended_at = v;
          }
        }
        if (ended_at !== null && ended_at < started_at)
          return bad("ended_at must be after started_at");
        const row = db
          .query(
            `UPDATE time_entries SET started_at = ?, ended_at = ?
             WHERE id = ? RETURNING id, task_id, started_at, ended_at`,
          )
          .get(started_at, ended_at, eid);
        return json(row);
      }) as unknown as Response;
    }

    if (method === "DELETE") {
      db.query(`DELETE FROM time_entries WHERE id = ?`).run(eid);
      return json({ ok: true });
    }
  }

  // POST /api/stop   (optional body { at } to backdate the stop, e.g. idle auto-stop)
  if (pathname === "/api/stop" && method === "POST") {
    return req.text().then((txt) => {
      let at = nowSQL();
      if (txt) {
        try {
          const v = toSQLts(JSON.parse(txt)?.at);
          if (v) at = v;
        } catch {
          /* empty / invalid body -> stop at now */
        }
      }
      // never backdate before the running entry started
      const running = getActive.get() as { started_at: string } | null;
      if (running && at < running.started_at) at = running.started_at;
      stopRunning.run(at);
      return json({ ok: true, stopped_at: at });
    }) as unknown as Response;
  }

  // GET /api/report?from=&to=  (ISO strings, UTC). Returns clipped entries.
  if (pathname === "/api/report" && method === "GET") {
    const from = (url.searchParams.get("from") ?? "").slice(0, 19).replace("T", " ");
    const to = (url.searchParams.get("to") ?? "").slice(0, 19).replace("T", " ");
    if (!from || !to) return bad("from and to are required");
    const now = nowSQL();
    // include running entries by treating ended_at as now; clip to [from,to]
    const rows = db
      .query(
        `SELECT e.id, e.task_id, t.title, t.status, t.recurrence,
                MAX(e.started_at, ?)              AS started_at,
                MIN(COALESCE(e.ended_at, ?), ?)   AS ended_at
         FROM time_entries e JOIN tasks t ON t.id = e.task_id
         WHERE COALESCE(e.ended_at, ?) >= ? AND e.started_at <= ?
         ORDER BY e.started_at`,
      )
      .all(from, now, to, now, from, to);
    return json({ entries: rows });
  }

  return bad("not found", 404);
}

// ---------- static (SPA) ----------
async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  let file = Bun.file(STATIC_ROOT + rel);
  if (!(await file.exists())) file = Bun.file(STATIC_ROOT + "/index.html");
  if (!(await file.exists()))
    return new Response("frontend not built (run: bun run build)", { status: 404 });
  return new Response(file);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, url);
      } catch (err) {
        console.error(err);
        return bad("internal error", 500);
      }
    }
    return serveStatic(url.pathname);
  },
});

console.log(`zeitgeber listening on http://localhost:${PORT}`);
