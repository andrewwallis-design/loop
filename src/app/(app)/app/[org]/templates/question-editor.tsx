"use client";

import { useState } from "react";
import type { QuestionKind } from "@/lib/types";
import { KIND_LABEL } from "./kinds";
import type { EditorQuestion } from "./actions";

type Row = EditorQuestion & { uid: number };

const KINDS = Object.keys(KIND_LABEL) as QuestionKind[];

/**
 * Simple add / remove / reorder list of questions. The result is serialised into a
 * hidden `questions` field so the surrounding plain HTML form can post it to a server action.
 */
export function QuestionEditor({ initial }: { initial: EditorQuestion[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((q, i) => ({ ...q, uid: i + 1 })));
  const [nextUid, setNextUid] = useState(initial.length + 1);

  function update(uid: number, patch: Partial<EditorQuestion>) {
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }
  function move(uid: number, dir: -1 | 1) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  function remove(uid: number) {
    setRows((rs) => rs.filter((r) => r.uid !== uid));
  }
  function add() {
    setRows((rs) => [...rs, { uid: nextUid, key: null, kind: "rating5", prompt: "", required: false, options: [] }]);
    setNextUid((n) => n + 1);
  }

  const serialised: EditorQuestion[] = rows.map((r) => ({ key: r.key, kind: r.kind, prompt: r.prompt, required: r.required, options: r.options }));

  return (
    <div className="space-y-3">
      <input type="hidden" name="questions" value={JSON.stringify(serialised)} />
      {rows.length === 0 && <p className="text-sm text-stone-500">No questions yet. Add one below.</p>}
      {rows.map((r, i) => (
        <div key={r.uid} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-2 w-6 shrink-0 text-right text-sm text-stone-400">{i + 1}.</span>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                className="input"
                placeholder="Question wording"
                value={r.prompt}
                onChange={(e) => update(r.uid, { prompt: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-3">
                <select className="input w-auto" value={r.kind} onChange={(e) => update(r.uid, { kind: e.target.value as QuestionKind })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={r.required} onChange={(e) => update(r.uid, { required: e.target.checked })} />
                  Required
                </label>
                {r.key && <span className="text-xs text-stone-500">key <code className="rounded bg-white px-1">{r.key}</code></span>}
                {!r.key && <span className="text-xs text-stone-400">key set from the wording when saved</span>}
              </div>
              {r.kind === "choice" && (
                <div>
                  <label className="label">Options, one per line</label>
                  <textarea
                    className="input min-h-20 text-sm"
                    value={r.options.join("\n")}
                    onChange={(e) => update(r.uid, { options: e.target.value.split("\n") })}
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => move(r.uid, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => move(r.uid, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
              <button type="button" className="btn-secondary px-2 py-1 text-xs text-red-700" onClick={() => remove(r.uid)} aria-label="Remove">✕</button>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={add}>Add a question</button>
    </div>
  );
}
