import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Respondent } from "@/lib/types";
import { Flash } from "@/components/flash";
import { deleteRespondent, markLeft, updateRespondent } from "../actions";
import { RespondentFields, StatusBadge, respondentStatus } from "../respondent-fields";

export default async function RespondentPage({
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
    .from("respondents")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!data) notFound();
  const person = data as Respondent;

  const { data: invitations } = await supabase
    .from("invitations")
    .select("id, status, channel, scheduled_for, sent_at, answered_at, campaigns(name)")
    .eq("organisation_id", access.org.id)
    .eq("respondent_id", id)
    .order("scheduled_for", { ascending: false })
    .limit(20);

  const save = updateRespondent.bind(null, slug, id);
  const left = markLeft.bind(null, slug, id);
  const remove = deleteRespondent.bind(null, slug, id);
  const canDelete = hasRole(access.role, "manager");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/respondents`} className="text-sm text-stone-500 hover:underline">← People</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{person.full_name}</h1>
          <StatusBadge status={respondentStatus(person)} />
        </div>
        <p className="mt-1 text-sm text-stone-600">
          Added {formatDate(person.created_at)}. Last changed {formatDate(person.updated_at)}.
          {person.unsubscribed_at && <> Unsubscribed {formatDateTime(person.unsubscribed_at)}.</>}
        </p>
      </div>

      <Flash ok={ok} error={error} />

      <form action={save} className="card space-y-4">
        <RespondentFields value={person} full />
        <div className="flex justify-end">
          <button className="btn-primary">Save</button>
        </div>
      </form>

      <div className="card">
        <h2 className="text-lg font-semibold">Recent invitations</h2>
        {!invitations || invitations.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">None yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2">Campaign</th>
                <th className="py-2">Channel</th>
                <th className="py-2">Status</th>
                <th className="py-2">Sent</th>
                <th className="py-2">Answered</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id} className="border-t border-stone-100">
                  <td className="py-2">{(i.campaigns as unknown as { name: string } | null)?.name ?? "—"}</td>
                  <td className="py-2 capitalize">{i.channel}</td>
                  <td className="py-2 capitalize">{i.status}</td>
                  <td className="py-2">{formatDate(i.sent_at ?? i.scheduled_for)}</td>
                  <td className="py-2">{formatDate(i.answered_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold">Leaving and removal</h2>
        <p className="mt-1 text-sm text-stone-600">
          Marking someone as left stops all invitations; the record is kept for {access.org.retention_contacts_months} months and then removed automatically.
          {canDelete && " Deleting removes the record now; their anonymous responses are kept."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!person.relationship_end && (
            <form action={left}>
              <button className="btn-secondary">Mark as left</button>
            </form>
          )}
          {canDelete && (
            <form action={remove}>
              <button className="btn-danger">Delete record</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
