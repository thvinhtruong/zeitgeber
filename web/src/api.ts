export type Status = "todo" | "doing" | "done" | "recurring";
export type Recurrence = "none" | "daily" | "weekly";

export interface Task {
  id: number;
  title: string;
  description: string;
  status: Status;
  recurrence: Recurrence;
  duration_minutes: number;
  planned_for: string | null; // local day key "YYYY-MM-DD"; null = backlog
  project_id: number | null;
  archived: number;
  created_at: string;
  updated_at: string;
  total_seconds: number;
}

export interface Project {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Active {
  task_id: number;
  started_at: string;
}

export interface TimeEntry {
  id: number;
  task_id: number;
  started_at: string; // "YYYY-MM-DD HH:MM:SS" (UTC)
  ended_at: string | null;
  seconds: number | null;
}

export interface ReportEntry {
  id: number;
  task_id: number;
  title: string;
  status: Status;
  recurrence: Recurrence;
  started_at: string; // "YYYY-MM-DD HH:MM:SS" (UTC)
  ended_at: string;
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? res.statusText);
  return res.json();
}

export const api = {
  tasks: () => req<{ tasks: Task[]; active: Active | null }>("/api/tasks"),
  create: (title: string, planned_for?: string) =>
    req<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(planned_for ? { title, planned_for } : { title }),
    }),
  update: (
    id: number,
    patch: Partial<
      Pick<
        Task,
        | "title"
        | "description"
        | "status"
        | "recurrence"
        | "duration_minutes"
        | "planned_for"
        | "project_id"
      >
    > & {
      archived?: boolean;
    },
  ) =>
    req<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => req(`/api/tasks/${id}`, { method: "DELETE" }),
  projects: () => req<{ projects: Project[] }>("/api/projects"),
  createProject: (name: string, color?: string) =>
    req<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(color ? { name, color } : { name }),
    }),
  updateProject: (id: number, patch: Partial<Pick<Project, "name" | "color">>) =>
    req<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeProject: (id: number) => req(`/api/projects/${id}`, { method: "DELETE" }),
  start: (id: number) => req(`/api/tasks/${id}/start`, { method: "POST" }),
  stop: (at?: string) =>
    req("/api/stop", { method: "POST", body: JSON.stringify(at ? { at } : {}) }),
  report: (from: Date, to: Date) =>
    req<{ entries: ReportEntry[] }>(
      `/api/report?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  entries: (taskId: number) =>
    req<{ entries: TimeEntry[] }>(`/api/tasks/${taskId}/entries`),
  addEntry: (taskId: number, started_at: string, ended_at: string) =>
    req<TimeEntry>(`/api/tasks/${taskId}/entries`, {
      method: "POST",
      body: JSON.stringify({ started_at, ended_at }),
    }),
  updateEntry: (id: number, patch: { started_at?: string; ended_at?: string | null }) =>
    req<TimeEntry>(`/api/entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeEntry: (id: number) => req(`/api/entries/${id}`, { method: "DELETE" }),
};

// Format a UTC SQLite timestamp for a <input type="datetime-local"> (local time).
export const toLocalInput = (s: string) => {
  const d = parseUTC(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Convert a datetime-local value (local time) back to a UTC ISO string.
export const fromLocalInput = (v: string) => new Date(v).toISOString();

// Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") into a Date.
export const parseUTC = (s: string) => new Date(s.replace(" ", "T") + "Z");
