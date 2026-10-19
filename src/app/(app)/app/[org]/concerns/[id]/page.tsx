import Link from "next/link";
import { notFound } from "next/navigation";
import { logAccess, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { Concern, Respondent, Response, TemplateQuestion } from "@/lib/types";
import { concernReasonLabel, daysBetween } from "@/lib/stats";
import { ConcernStatusBadge } from "@/components/feedback-ui";
import { Flash } from "@/components/flash";
import { ResponseAnswers } from "@/components/response-answers";
import { RespondentCard } from "@/components/respondent-card";
import { closeConcern, reopenConcern, takeOwnership } from "../actions";

export default async function ConcernPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug, "manager");
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("concerns")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!data) notFound();
  const concern = data as Concern;

  const { data: responseData } = await supabase.from("responses").select("*").eq("id", concern.response_id).maybeSingle();
  const response = (responseData ?? null) as Response | null;

  const [{ data: template }, { data: questionsData }] = response
    ? await Promise.all([
        supabase.from("templates").select("id, name").eq("id", response.template_id).maybeSingle(),
        supabase.from("template_questions").select("*").eq("template_id", response.template_id).order("position"),
      ])
    : [{ data: null }, { data: [] }];
  const questions = (questionsData ?? []) as TemplateQuestion[];

  let person: Respondent | null = null;
  if (response?.contactable && response.respondent_id) {
    const { data: p } = await supabase.from("respondents").select("*").eq("id", response.respondent_id).maybeSingle();
    if (p) {
      person = p as Respondent;
      await logAccess(access, "view_response", "response", response.id, { via: "concern", concern_id: concern.id });
    }
  }

  const userIds = [concern.owner_user_id, concern.closed_by].filter((x): x is string => !!x);
  const people = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
    for (const p of profiles ?? []) people.set(p.id, p.full_name ?? p.email);
  }

  const isMine = concern.owner_user_id === access.session.userId;
  const closed = concern.status === "closed";
  const own = takeOwnership.bind(null, slug, concern.id);
  const close = closeConcern.bind(null, slug, concern.id);
  const reopen = reopenConcern.bind(null, slug, concern.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/concerns`} className="text-sm text-stone-500 hover:underline">← Concerns</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{concernReasonLabel(concern.reason)}</h1>
          <ConcernStatusBadge status={concern.status} />
        </div>
        <p className="mt-1 text-sm text-stone-600">
          Raised {formatDateTime(concern.created_at)}
          {template && <> from “{template.name}”</>}
          {closed
            ? <> · closed after {daysBetween(concern.created_at, concern.closed_at ?? undefined)} {daysBetween(concern.created_at, concern.closed_at ?? undefined) === 1 ? "day" : "days"}</>
            : <> · open for {daysBetween(concern.created_at)} {daysBetween(concern.created_at) === 1 ? "day" : "days"}</>}
        </p>
      </div>

      <Flash ok={ok} error={error} />

      <div className="card">
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Why it was flagged</div>
        <p className="mt-1 text-base">{concern.summary ?? "—"}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-stone-500">Owner</dt>
            <dd className={concern.owner_user_id ? "" : "text-red-700"}>
              {concern.owner_user_id ? people.get(concern.owner_user_id) ?? "—" : "Nobody yet"}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Alert sent</dt>
            <dd>{concern.alerted_at ? formatDateTime(concern.alerted_at) : "Not sent"}</dd>
          </div>
          {closed && (
            <div>
              <dt className="text-stone-500">Closed</dt>
              <dd>
                {formatDateTime(concern.closed_at)}
                {concern.closed_by && <> by {people.get(concern.closed_by) ?? "—"}</>}
              </dd>
            </div>
          )}
        </dl>
        {closed && concern.closure_note && (
          <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-900">
            <div className="text-xs font-medium uppercase tracking-wide text-green-800">Closure note</div>
            <p className="mt-1 whitespace-pre-wrap">{concern.closure_note}</p>
          </div>
        )}
        {!closed && (
          <div className="mt-4 flex flex-wrap gap-2">
            {!isMine && (
              <form action={own}>
                <button className="btn-secondary">Take ownership</button>
              </form>
            )}
            {isMine && <span className="self-center text-sm text-stone-500">You own this concern.</span>}
          </div>
        )}
        {closed && (
          <form action={reopen} className="mt-4">
            <button className="btn-secondary">Reopen</button>
          </form>
        )}
      </div>

      {person ? (
        <RespondentCard slug={slug} person={person} title="Who raised it" />
      ) : (
        <div className="card text-sm text-stone-600">
          {response?.contactable
            ? "The person who gave this response is no longer on record."
            : "Given anonymously. There is nobody to contact, so look for patterns instead."}
        </div>
      )}

      {response ? (
        <ResponseAnswers response={response} questions={questions} />
      ) : (
        <div className="card text-sm text-stone-600">The response behind this concern is no longer available.</div>
      )}

      {!closed && (
        <form action={close} className="card space-y-3">
          <h2 className="text-lg font-semibold">Close this concern</h2>
          <p className="text-sm text-stone-600">
            Say what you found and what was done. This note goes into the compliance report, so write it for an inspector.
          </p>
          <div>
            <label className="label" htmlFor="closure_note">Closure note</label>
            <textarea id="closure_note" name="closure_note" className="input min-h-32" required minLength={10} />
          </div>
          <div className="flex justify-end">
            <button className="btn-primary">Close concern</button>
          </div>
        </form>
      )}
    </div>
  );
}
