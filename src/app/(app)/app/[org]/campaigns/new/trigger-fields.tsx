"use client";

import { useState } from "react";
import type { TriggerKind } from "@/lib/types";
import { CRON_PRESETS, TRIGGER_LABEL } from "../constants";

/** Trigger selector plus the fields that apply to the chosen trigger kind. Posts plain form fields. */
export function TriggerFields({ canSchedule }: { canSchedule: boolean }) {
  const [kind, setKind] = useState<TriggerKind>("adhoc");
  const [preset, setPreset] = useState<string>(CRON_PRESETS[0].value);

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="trigger_kind">When it runs</label>
        <select id="trigger_kind" name="trigger_kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as TriggerKind)}>
          <option value="adhoc">{TRIGGER_LABEL.adhoc}: you pick people and press send</option>
          <option value="event_relative" disabled={!canSchedule}>{TRIGGER_LABEL.event_relative}: N days after a date on the person’s record</option>
          <option value="calendar" disabled={!canSchedule}>{TRIGGER_LABEL.calendar}: quarterly, annually, monthly</option>
        </select>
        {!canSchedule && <p className="mt-1 text-xs text-stone-500">Scheduled campaigns need a manager; you can set up an ad hoc send.</p>}
      </div>

      {kind === "event_relative" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="event_field">Date to count from</label>
            <select id="event_field" name="event_field" className="input" defaultValue="relationship_start">
              <option value="relationship_start">Relationship start (care began, joined)</option>
              <option value="event_date">Event date (medical, treatment, visit)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="offset_days">Days after that date</label>
            <input id="offset_days" name="offset_days" type="number" min={0} max={3650} className="input" defaultValue={14} />
          </div>
        </div>
      )}

      {kind === "calendar" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="schedule_preset">Schedule</label>
            <select id="schedule_preset" name="schedule_preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {CRON_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              <option value="custom">Custom cron expression…</option>
            </select>
          </div>
          {preset === "custom" && (
            <div>
              <label className="label" htmlFor="schedule_cron">Cron (minute hour day month weekday), UK time</label>
              <input id="schedule_cron" name="schedule_cron" className="input font-mono" placeholder="7 10 1 1,4,7,10 *" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
