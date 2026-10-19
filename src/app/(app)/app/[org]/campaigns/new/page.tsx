import Link from "next/link";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CHANNEL_LABEL, RESPONDENT_TYPE_LABEL, type Channel, type RespondentType, type Template } from "@/lib/types";
import { Flash } from "@/components/flash";
import { createCampaign } from "../actions";
import { DEFAULT_MESSAGE } from "../constants";
import { TriggerFields } from "./trigger-fields";

const CHANNEL_ORDER: Channel[] = ["whatsapp", "email", "sms"];

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "staff");
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("templates")
    .select("id, name, audience, is_pulse")
    .eq("organisation_id", access.org.id)
    .eq("is_current", true)
    .order("name");
  const templates = (data ?? []) as Pick<Template, "id" | "name" | "audience" | "is_pulse">[];
  const action = createCampaign.bind(null, slug);
  const canSchedule = hasRole(access.role, "manager");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/campaigns`} className="text-sm text-stone-500 hover:underline">← Campaigns</Link>
        <h1 className="mt-1 text-2xl font-semibold">New campaign</h1>
        <p className="mt-1 text-sm text-stone-600">It starts as a draft. Send yourself a test, then activate it.</p>
      </div>
      <Flash error={error} />

      <form action={action} className="space-y-6">
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" required placeholder="Quarterly client survey" />
          </div>
          <div>
            <label className="label" htmlFor="template_id">Survey</label>
            <select id="template_id" name="template_id" className="input" required defaultValue="">
              <option value="" disabled>Choose a survey…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({RESPONDENT_TYPE_LABEL[t.audience]}{t.is_pulse ? ", pulse" : ""})
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">No surveys yet. <Link className="underline" href={`/app/${slug}/templates/new`}>Create one first.</Link></p>
            )}
          </div>
          <TriggerFields canSchedule={canSchedule} />
        </div>

        <div className="card space-y-4">
          <div>
            <span className="label">Who to ask</span>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="audience_types" value={t} defaultChecked={t === "client"} />
                  {RESPONDENT_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Channels, in order of preference</span>
            <div className="flex flex-wrap gap-3">
              {CHANNEL_ORDER.map((c, i) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="channels" value={c} defaultChecked={c === "email"} />
                  <span className="text-stone-400">{i + 1}.</span> {CHANNEL_LABEL[c]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              Each person gets one message on the first channel they can receive: WhatsApp only if they have opted in, SMS only with a mobile.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="message">Message</label>
            <textarea id="message" name="message" className="input min-h-24" defaultValue={DEFAULT_MESSAGE} />
            <p className="mt-1 text-xs text-stone-500">
              <code>{"{{name}}"}</code>, <code>{"{{org}}"}</code> and <code>{"{{link}}"}</code> are filled in for each person.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="reminder_after_days">Reminder after (days)</label>
              <input id="reminder_after_days" name="reminder_after_days" type="number" min={0} max={60} className="input" defaultValue={5} />
              <p className="mt-1 text-xs text-stone-500">0 means no reminder.</p>
            </div>
            <div>
              <label className="label" htmlFor="min_days_between_surveys">Leave at least (days) between surveys</label>
              <input id="min_days_between_surveys" name="min_days_between_surveys" type="number" min={0} max={730} className="input" defaultValue={30} />
              <p className="mt-1 text-xs text-stone-500">Nobody is asked a full survey more often than this.</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Link href={`/app/${slug}/campaigns`} className="btn-secondary">Cancel</Link>
          <button className="btn-primary" disabled={templates.length === 0}>Create draft</button>
        </div>
      </form>
    </div>
  );
}
