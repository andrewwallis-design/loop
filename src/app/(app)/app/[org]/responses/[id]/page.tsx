import Link from "next/link";
import { notFound } from "next/navigation";
import { logAccess, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { Respondent, Response, TemplateQuestion } from "@/lib/types";
import { CHANNEL_OR_SOURCE_LABEL, SOURCE_LABEL, concernReasonLabel } from "@/lib/stats";
import { ConcernBadge } from "@/components/feedback-ui";
import { ResponseAnswers } from "@/components/response-answers";
import { RespondentCard } from "@/components/respondent-card";

export default async function ResponseDetailPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug);
  const supabase = await createClient();

  const { data } = await supabase
    .from("responses")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!data) notFound();
  const response = data as Response;

  const [{ data: template }, { data: questionsData }] = await Promise.all([
    supabase.from("templates").select("id, name, version").eq("id", response.template_id).maybeSingle(),
    supabase.from("template_questions").select("*").eq("template_id", response.template_id).order("position"),
  ]);
  const questions = (questionsData ?? []) as TemplateQuestion[];

  let channel: string | null = null;
  if (response.invitation_id) {
    const { data: inv } = await supabase.from("invitations").select("channel").eq("id", response.invitation_id).maybeSingle();
    channel = inv?.channel ?? null;
  }

  let concern: { id: string; status: string; reason: string } | null = null;
  if (access.canSeeIdentity) {
    const { data: c } = await supabase.from("concerns").select("id, status, reason").eq("response_id", response.id).maybeSingle();
    concern = c ?? null;
  }

  let person: Respondent | null = null;
  if (access.canSeeIdentity && response.contactable && response.respondent_id) {
    const { data: p } = await supabase.from("respondents").select("*").eq("id", response.respondent_id).maybeSingle();
    if (p) {
      person = p as Respondent;
      await logAccess(access, "view_response", "response", response.id);
    }
  }

  let enteredBy: string | null = null;
  if (response.entered_by) {
    const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", response.entered_by).maybeSingle();
    enteredBy = prof?.full_name ?? prof?.email ?? null;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/responses`} className="text-sm text-stone-500 hover:underline">← Responses</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{template?.name ?? "Response"}</h1>
          <ConcernBadge concern={response.concern} />
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {formatDateTime(response.created_at)} · {channel ? CHANNEL_OR_SOURCE_LABEL[channel] ?? channel : SOURCE_LABEL[response.source]}
          {enteredBy && <> · entered by {enteredBy}</>}
          {template && template.version > 1 && <> · survey v{template.version}</>}
        </p>
      </div>

      {concern && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This response raised a concern ({concernReasonLabel(concern.reason)}, {concern.status.replace("_", " ")}).{" "}
          <Link href={`/app/${slug}/concerns/${concern.id}`} className="font-medium underline">Open the concern</Link>
        </div>
      )}
      {!concern && response.concern && response.concern_reason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Flagged: {response.concern_reason}
        </div>
      )}

      {access.canSeeIdentity ? (
        person ? (
          <RespondentCard slug={slug} person={person} />
        ) : (
          <div className="card text-sm text-stone-600">
            {response.contactable
              ? "The person who gave this response is no longer on record."
              : response.anonymised_at
                ? "This response has been anonymised under the retention policy."
                : "This response was given anonymously."}
          </div>
        )
      ) : (
        <div className="card text-sm text-stone-600">Anonymous. Your role does not show who gave feedback.</div>
      )}

      <ResponseAnswers response={response} questions={questions} />
    </div>
  );
}
