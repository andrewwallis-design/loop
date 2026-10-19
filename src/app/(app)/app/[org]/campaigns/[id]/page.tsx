import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  CHANNEL_LABEL,
  RESPONDENT_TYPE_LABEL,
  type Campaign,
  type Invitation,
  type Respondent,
  type Template,
} from "@/lib/types";
import { Flash } from "@/components/flash";
import { activateCampaign, pauseCampaign, sendNow, sendTest } from "../actions";
import { INVITATION_BADGE, STATUS_BADGE, TRIGGER_LABEL, describeCron } from "../constants";
import { RespondentPicker, type PickerPerson } from "./respondent-picker";

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug, "staff");
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("campaigns")
    .select("*, templates(id, name, version, is_pulse)")
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!data) notFound();
  const campaign = data as Campaign & { templates: Pick<Template, "id" | "name" | "version" | "is_pulse"> | null };

  const { data: invRows } = await supabase
    .from("invitations")
    .select("*, respondents(full_name)")
    .eq("organisation_id", access.org.id)
    .eq("campaign_id", id)
    .order("scheduled_for", { ascending: false })
    .limit(500);
  const invitations = (invRows ?? []) as Array<Invitation & { respondents: { full_name: string } | null }>;
  const invited = new Set(invitations.map((i) => i.respondent_id));

  const sent = invitations.filter((i) => i.sent_at).length;
  const answered = invitations.filter((i) => i.status === "answered").length;
  const queued = invitations.filter((i) => i.status === "scheduled").length;
  const rate = sent > 0 ? Math.round((answered / sent) * 100) : null;

  const isManager = hasRole(access.role, "manager");

  // Eligible people for an ad hoc send: audience type, active, not unsubscribed, consenting
  let picker: PickerPerson[] = [];
  if (campaign.trigger_kind === "adhoc") {
    const { data: people } = await supabase
      .from("respondents")
      .select("id, full_name, type, email, mobile")
      .eq("organisation_id", access.org.id)
      .in("type", campaign.audience_types)
      .is("relationship_end", null)
      .is("unsubscribed_at", null)
      .eq("consent_feedback", true)
      .order("full_name")
      .limit(1000);
    picker = ((people ?? []) as Pick<Respondent, "id" | "full_name" | "type" | "email" | "mobile">[]).map((p) => ({
      ...p,
      alreadyInvited: invited.has(p.id),
    }));
  }

  const testAction = sendTest.bind(null, slug, id);
  const activate = activateCampaign.bind(null, slug, id);
  const pause = pauseCampaign.bind(null, slug, id);
  const send = sendNow.bind(null, slug, id);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${slug}/campaigns`} className="text-sm text-stone-500 hover:underline">← Campaigns</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <span className={`badge ${STATUS_BADGE[campaign.status]} capitalize`}>{campaign.status}</span>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {campaign.templates ? (
            <Link href={`/app/${slug}/templates/${campaign.templates.id}`} className="hover:underline">
              {campaign.templates.name} (v{campaign.templates.version})
            </Link>
          ) : (
            "Survey missing"
          )}
          {" · "}
          {TRIGGER_LABEL[campaign.trigger_kind]}
          {campaign.trigger_kind === "event_relative" && ` · ${campaign.offset_days} days after ${campaign.event_field === "event_date" ? "event date" : "relationship start"}`}
          {campaign.trigger_kind === "calendar" && ` · ${describeCron(campaign.schedule_cron)}`}
          {" · "}
          {campaign.audience_types.map((t) => RESPONDENT_TYPE_LABEL[t]).join(", ")}
          {" · "}
          {campaign.channels.map((c) => CHANNEL_LABEL[c]).join(" → ")}
        </p>
      </div>

      <Flash ok={ok} error={error} />

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Queued" value={queued} />
        <Stat label="Sent" value={sent} />
        <Stat label="Answered" value={answered} />
        <Stat label="Response rate" value={rate === null ? "—" : `${rate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="text-base font-semibold">Test</h2>
          <p className="text-sm text-stone-600">
            {campaign.test_sent_at ? `Last test sent ${formatDateTime(campaign.test_sent_at)}.` : "No test sent yet. A campaign cannot go live until one has."}
          </p>
          <form action={testAction} className="flex flex-wrap gap-2">
            <input name="email" type="email" className="input max-w-xs" defaultValue={access.session.profile.email} />
            <button className="btn-secondary">Send test to this email</button>
          </form>
          {campaign.message && (
            <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
              <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Message</div>
              <div className="whitespace-pre-wrap">{campaign.message}</div>
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="text-base font-semibold">Status</h2>
          <p className="text-sm text-stone-600">
            {campaign.trigger_kind === "adhoc"
              ? "Ad hoc campaigns send when you choose people below."
              : campaign.status === "active"
                ? "Running. The scheduler queues invitations as people become due and sends them outside quiet hours."
                : "Paused or draft: nothing is queued until it is activated."}
            {campaign.last_run_at && <> Last run {formatDateTime(campaign.last_run_at)}.</>}
          </p>
          <p className="text-sm text-stone-600">
            Reminder after {campaign.reminder_after_days} day{campaign.reminder_after_days === 1 ? "" : "s"}; at least {campaign.min_days_between_surveys} days between surveys.
          </p>
          {isManager ? (
            <div className="flex flex-wrap gap-2">
              {campaign.status !== "active" && (
                <form action={activate}>
                  <button className="btn-primary" disabled={!campaign.test_sent_at} title={campaign.test_sent_at ? undefined : "Send a test first"}>Activate</button>
                </form>
              )}
              {campaign.status === "active" && (
                <form action={pause}>
                  <button className="btn-secondary">Pause</button>
                </form>
              )}
            </div>
          ) : (
            <p className="text-xs text-stone-500">A manager can activate or pause this campaign.</p>
          )}
        </div>
      </div>

      {campaign.trigger_kind === "adhoc" && (
        <div className="card">
          <h2 className="text-base font-semibold">Send now</h2>
          <p className="mb-3 mt-1 text-sm text-stone-600">
            Choose who to ask. People who have left, unsubscribed or been surveyed recently are skipped automatically.
            {!campaign.test_sent_at && " Send yourself a test first."}
          </p>
          {picker.length === 0 ? (
            <p className="text-sm text-stone-500">No eligible people for this audience. <Link href={`/app/${slug}/respondents`} className="underline">Add some.</Link></p>
          ) : (
            <form action={send}>
              <RespondentPicker people={picker} />
            </form>
          )}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-base font-semibold">Invitations</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Scheduled</th>
              <th className="px-4 py-3">Sent</th>
              <th className="px-4 py-3">Answered</th>
            </tr>
          </thead>
          <tbody>
            {invitations.length === 0 && (
              <tr className="border-t border-stone-100">
                <td colSpan={6} className="px-4 py-8 text-center text-stone-500">No invitations yet.</td>
              </tr>
            )}
            {invitations.map((i) => (
              <tr key={i.id} className="border-t border-stone-100">
                <td className="px-4 py-2">
                  <Link href={`/app/${slug}/respondents/${i.respondent_id}`} className="hover:underline">{i.respondents?.full_name ?? "—"}</Link>
                </td>
                <td className="px-4 py-2 text-stone-700">{CHANNEL_LABEL[i.channel]}</td>
                <td className="px-4 py-2">
                  <span className={`badge ${INVITATION_BADGE[i.status]} capitalize`}>{i.status}</span>
                  {i.error && <div className="mt-0.5 max-w-xs truncate text-xs text-red-700" title={i.error}>{i.error}</div>}
                </td>
                <td className="px-4 py-2 text-stone-700">{formatDate(i.scheduled_for)}</td>
                <td className="px-4 py-2 text-stone-700">{formatDate(i.sent_at)}</td>
                <td className="px-4 py-2 text-stone-700">{formatDate(i.answered_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card py-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
