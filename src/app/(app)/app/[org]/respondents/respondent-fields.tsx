import { RESPONDENT_TYPE_LABEL, type Respondent, type RespondentType } from "@/lib/types";
import { formatPhone } from "@/lib/phone";

/** Form fields shared by the quick-add card and the edit page. */
export function RespondentFields({ value, full }: { value?: Partial<Respondent>; full?: boolean }) {
  const v = value ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="full_name">Full name</label>
        <input id="full_name" name="full_name" className="input" required defaultValue={v.full_name ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" defaultValue={v.email ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="mobile">Mobile</label>
        <input id="mobile" name="mobile" className="input" placeholder="07700 900123" defaultValue={formatPhone(v.mobile)} />
      </div>
      <div>
        <label className="label" htmlFor="type">Type</label>
        <select id="type" name="type" className="input" defaultValue={v.type ?? "client"}>
          {(Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[]).map((t) => (
            <option key={t} value={t}>{RESPONDENT_TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="relates_to">Relates to <span className="font-normal text-stone-500">(next of kin only)</span></label>
        <input id="relates_to" name="relates_to" className="input" placeholder="Name of the client" defaultValue={v.relates_to ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="relationship_start">Relationship start</label>
        <input id="relationship_start" name="relationship_start" type="date" className="input" defaultValue={v.relationship_start ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="event_date">Event date <span className="font-normal text-stone-500">(medical, treatment)</span></label>
        <input id="event_date" name="event_date" type="date" className="input" defaultValue={v.event_date ?? ""} />
      </div>
      {full && (
        <>
          <div>
            <label className="label" htmlFor="relationship_end">Relationship end</label>
            <input id="relationship_end" name="relationship_end" type="date" className="input" defaultValue={v.relationship_end ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="external_ref">Reference</label>
            <input id="external_ref" name="external_ref" className="input" placeholder="ACP id, booking ref" defaultValue={v.external_ref ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" className="input min-h-24" defaultValue={v.notes ?? ""} />
          </div>
        </>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2">
        {full && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="consent_feedback" defaultChecked={v.consent_feedback ?? true} />
            Happy to be asked for feedback
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="consent_news" defaultChecked={v.consent_news ?? false} />
          Happy to receive news and updates
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="whatsapp_opt_in" defaultChecked={v.whatsapp_opt_in ?? false} />
          Has agreed to WhatsApp messages
        </label>
      </div>
    </div>
  );
}

export type RespondentStatus = "active" | "left" | "unsubscribed";

export function respondentStatus(r: Pick<Respondent, "relationship_end" | "unsubscribed_at" | "consent_feedback">): RespondentStatus {
  if (r.unsubscribed_at || !r.consent_feedback) return "unsubscribed";
  if (r.relationship_end) return "left";
  return "active";
}

export function StatusBadge({ status }: { status: RespondentStatus }) {
  const cls =
    status === "active"
      ? "bg-green-100 text-green-800"
      : status === "left"
        ? "bg-stone-200 text-stone-700"
        : "bg-amber-100 text-amber-800";
  const label = status === "active" ? "Active" : status === "left" ? "Left" : "Unsubscribed";
  return <span className={`badge ${cls}`}>{label}</span>;
}
