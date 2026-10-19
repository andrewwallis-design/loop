import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { merge } from "@/lib/send";
import { CHANNEL_LABEL, RESPONDENT_TYPE_LABEL, type Broadcast, type Channel, type Respondent } from "@/lib/types";
import { Flash } from "@/components/flash";
import { BroadcastFields } from "../broadcast-fields";
import { estimateRecipients } from "../recipients";
import { deleteBroadcast, sendBroadcastAction, updateBroadcast } from "../actions";

export default async function BroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; edit?: string }>;
}) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug, "manager");
  const { ok, error, edit } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!data) notFound();
  const broadcast = data as Broadcast;
  const isDraft = broadcast.status === "draft";

  // Recipient estimate for drafts; actual recipient log once sent
  const { data: peopleData } = isDraft
    ? await supabase
        .from("respondents")
        .select("type, email, mobile, unsubscribed_at, relationship_end, consent_news, whatsapp_opt_in")
        .eq("organisation_id", access.org.id)
    : { data: [] };
  const estimate = estimateRecipients(
    broadcast,
    (peopleData ?? []) as Pick<Respondent, "type" | "email" | "mobile" | "unsubscribed_at" | "relationship_end" | "consent_news" | "whatsapp_opt_in">[],
  );

  const { data: recips } = isDraft
    ? { data: [] }
    : await supabase.from("broadcast_recipients").select("channel, status").eq("broadcast_id", broadcast.id);
  const log = { total: 0, sent: 0, failed: 0, queued: 0, byChannel: {} as Partial<Record<Channel, number>> };
  for (const r of recips ?? []) {
    log.total += 1;
    if (r.status === "sent" || r.status === "delivered") log.sent += 1;
    else if (r.status === "failed" || r.status === "bounced") log.failed += 1;
    else log.queued += 1;
    log.byChannel[r.channel as Channel] = (log.byChannel[r.channel as Channel] ?? 0) + 1;
  }

  const preview = merge(broadcast.body, { name: "Margaret", org: access.org.short_name ?? access.org.name });
  const paragraphs = preview.replace(/\r\n/g, "\n").split(/\n{2,}/).filter((p) => p.trim());

  const send = sendBroadcastAction.bind(null, slug, broadcast.id);
  const update = updateBroadcast.bind(null, slug, broadcast.id);
  const remove = deleteBroadcast.bind(null, slug, broadcast.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/broadcasts`} className="text-sm text-stone-500 hover:underline">← Broadcasts</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{broadcast.subject}</h1>
          <span className={`badge capitalize ${isDraft ? "bg-stone-100 text-stone-700" : "bg-green-50 text-green-800"}`}>{broadcast.status}</span>
          {broadcast.is_marketing && <span className="badge bg-purple-50 text-purple-800">News / marketing</span>}
        </div>
        <p className="mt-1 text-sm text-stone-600">
          To {broadcast.audience_types.map((t) => RESPONDENT_TYPE_LABEL[t].toLowerCase()).join(", ")} by{" "}
          {broadcast.channels.map((c) => CHANNEL_LABEL[c]).join(" then ")}.
          {broadcast.sent_at && <> Sent {formatDateTime(broadcast.sent_at)}.</>}
        </p>
      </div>

      <Flash ok={ok} error={error} />

      {isDraft && edit === "1" ? (
        <form action={update} className="card space-y-5">
          <h2 className="text-lg font-semibold">Edit draft</h2>
          <BroadcastFields value={broadcast} />
          <div className="flex justify-end gap-2">
            <Link href={`/app/${slug}/broadcasts/${broadcast.id}`} className="btn-secondary">Cancel</Link>
            <button className="btn-primary">Save changes</button>
          </div>
        </form>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="card md:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Preview</h2>
                <span className="text-xs text-stone-500">as Margaret would see it</span>
              </div>
              <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
                <div className="text-sm font-semibold">{broadcast.subject}</div>
                <div className="mt-3 space-y-3 text-sm text-stone-800">
                  {paragraphs.map((p, i) => (
                    <p key={i} className="whitespace-pre-wrap">{p}</p>
                  ))}
                  {broadcast.attachment_url && (
                    <p>
                      <a href={broadcast.attachment_url} className="text-brand underline" target="_blank" rel="noreferrer">{broadcast.attachment_url}</a>
                    </p>
                  )}
                </div>
                <p className="mt-4 text-xs text-stone-500">— {access.org.from_name ?? access.org.name}</p>
              </div>
            </div>

            <div className="card">
              {isDraft ? (
                <>
                  <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Will reach</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">{estimate.total}</div>
                  <ul className="mt-2 space-y-1 text-sm text-stone-700">
                    {Object.entries(estimate.byChannel).map(([c, n]) => (
                      <li key={c}>{n} by {CHANNEL_LABEL[c as Channel]}</li>
                    ))}
                  </ul>
                  <div className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-500">
                    <div>Not included:</div>
                    <ul className="mt-1 space-y-0.5">
                      <li>{estimate.excluded.unsubscribed} unsubscribed</li>
                      <li>{estimate.excluded.left} no longer with us</li>
                      {broadcast.is_marketing && <li>{estimate.excluded.noNewsConsent} not opted in to news</li>}
                      <li>{estimate.excluded.noChannel} no usable contact details</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Recipients</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">{log.total}</div>
                  <ul className="mt-2 space-y-1 text-sm text-stone-700">
                    <li>{log.sent} sent</li>
                    {log.failed > 0 && <li className="text-red-700">{log.failed} failed</li>}
                    {log.queued > 0 && <li>{log.queued} queued</li>}
                  </ul>
                  <ul className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-500">
                    {Object.entries(log.byChannel).map(([c, n]) => (
                      <li key={c}>{n} by {CHANNEL_LABEL[c as Channel]}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {isDraft && (
            <div className="card flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-stone-600">
                {estimate.total === 0
                  ? "Nobody matches this audience and channel set yet."
                  : `Ready to send to ${estimate.total} ${estimate.total === 1 ? "person" : "people"}. This cannot be undone.`}
              </div>
              <div className="flex gap-2">
                <form action={remove}>
                  <button className="btn-danger">Delete draft</button>
                </form>
                <Link href={`/app/${slug}/broadcasts/${broadcast.id}?edit=1`} className="btn-secondary">Edit</Link>
                <form action={send}>
                  <button className="btn-primary" disabled={estimate.total === 0}>Send now</button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
