import { CHANNEL_LABEL, RESPONDENT_TYPE_LABEL, type Broadcast, type Channel, type RespondentType } from "@/lib/types";

const AUDIENCES = Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[];
const CHANNELS: Channel[] = ["email", "whatsapp"];

/** Form fields for a broadcast draft (used by new and edit). */
export function BroadcastFields({ value }: { value?: Partial<Broadcast> }) {
  return (
    <>
      <div>
        <label className="label" htmlFor="subject">Subject</label>
        <input id="subject" name="subject" className="input" required maxLength={200} defaultValue={value?.subject ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="body">Message</label>
        <textarea id="body" name="body" className="input min-h-56" required defaultValue={value?.body ?? ""} />
        <p className="mt-1 text-xs text-stone-500">
          Plain text. Leave a blank line between paragraphs. Write <code className="rounded bg-stone-100 px-1">{"{{name}}"}</code> where the person’s first name should go.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="label">Send to</legend>
          <div className="space-y-1">
            {AUDIENCES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="audience_types"
                  value={t}
                  defaultChecked={value?.audience_types ? value.audience_types.includes(t) : t === "client"}
                />
                {RESPONDENT_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">Channels</legend>
          <div className="space-y-1">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="channels" value={c} defaultChecked={value?.channels ? value.channels.includes(c) : c === "email"} />
                {CHANNEL_LABEL[c]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-500">Each person gets the message once, by the first channel listed that they can receive. WhatsApp only goes to people who have opted in.</p>
        </fieldset>
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="is_marketing" className="mt-1" defaultChecked={value?.is_marketing ?? false} />
          <span>
            <span className="font-medium">This is news or marketing</span>
            <span className="block text-stone-600">Tick for newsletters and anything promoting services. Only people who have opted in to news will receive it.</span>
          </span>
        </label>
      </div>
      <div>
        <label className="label" htmlFor="attachment_url">Attachment link (optional)</label>
        <input id="attachment_url" name="attachment_url" className="input" type="url" placeholder="https://…" defaultValue={value?.attachment_url ?? ""} />
        <p className="mt-1 text-xs text-stone-500">A link to a PDF or page, added at the end of the message.</p>
      </div>
    </>
  );
}
