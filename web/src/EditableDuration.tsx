import { useEffect, useRef, useState } from "react";
import { api, type Task } from "./api";
import { formatMinutes, parseMinutes } from "./format";

export default function EditableDuration({
  task,
  onSaved,
  onError,
}: {
  task: Task;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(formatMinutes(task.duration_minutes));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  async function save() {
    const mins = parseMinutes(value);
    if (mins === null) {
      onError("Invalid duration — try e.g. 1h30m, 90, or 45m");
      setValue(formatMinutes(task.duration_minutes));
      setEditing(false);
      return;
    }
    setEditing(false);
    if (mins !== task.duration_minutes) {
      try {
        await api.update(task.id, { duration_minutes: mins });
        onSaved();
      } catch (e: any) {
        onError(e.message);
      }
    }
  }

  return editing ? (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setValue(formatMinutes(task.duration_minutes));
          setEditing(false);
        }
      }}
      aria-label={`Planned duration for ${task.title}`}
      className="w-16 rounded-md border border-indigo-400 bg-white px-2 py-1 text-right text-xs outline-none dark:bg-slate-800"
    />
  ) : (
    <button
      onClick={() => {
        setValue(formatMinutes(task.duration_minutes));
        setEditing(true);
      }}
      title="Edit planned duration"
      className="cursor-pointer font-mono tabular-nums text-slate-500 hover:text-indigo-500"
    >
      {formatMinutes(task.duration_minutes)}
    </button>
  );
}
