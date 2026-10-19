"use client";

import { useMemo, useState } from "react";
import { RESPONDENT_TYPE_LABEL, type RespondentType } from "@/lib/types";

export interface PickerPerson {
  id: string;
  full_name: string;
  type: RespondentType;
  email: string | null;
  mobile: string | null;
  alreadyInvited: boolean;
}

/** Checkbox list of eligible people. Lives inside a plain form; posts `respondent_ids`. */
export function RespondentPicker({ people }: { people: PickerPerson[] }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return people;
    return people.filter((p) => p.full_name.toLowerCase().includes(term) || (p.email ?? "").toLowerCase().includes(term));
  }, [people, q]);
  const selectable = shown.filter((p) => !p.alreadyInvited);

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  function selectAllShown() {
    setSelected((s) => {
      const n = new Set(s);
      for (const p of selectable) n.add(p.id);
      return n;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Filter by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={selectAllShown} disabled={selectable.length === 0}>
          Select all shown ({selectable.length})
        </button>
        <button type="button" className="btn-secondary" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          Clear
        </button>
        <span className="text-sm text-stone-600">{selected.size} selected</span>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-stone-200">
        {shown.length === 0 && <p className="p-4 text-sm text-stone-500">No one matches.</p>}
        {shown.map((p) => (
          <label
            key={p.id}
            className={`flex items-center gap-3 border-t border-stone-100 px-3 py-2 text-sm first:border-0 ${p.alreadyInvited ? "text-stone-400" : "hover:bg-stone-50"}`}
          >
            <input
              type="checkbox"
              name="respondent_ids"
              value={p.id}
              disabled={p.alreadyInvited}
              checked={selected.has(p.id)}
              onChange={(e) => toggle(p.id, e.target.checked)}
            />
            <span className="flex-1">
              {p.full_name}
              <span className="ml-2 text-xs text-stone-500">{RESPONDENT_TYPE_LABEL[p.type]}</span>
            </span>
            <span className="truncate text-xs text-stone-500">{p.email ?? p.mobile}</span>
            {p.alreadyInvited && <span className="badge bg-stone-100 text-stone-600">Already invited</span>}
          </label>
        ))}
      </div>
      <button className="btn-primary" disabled={selected.size === 0}>
        Send to {selected.size} {selected.size === 1 ? "person" : "people"}
      </button>
    </div>
  );
}
