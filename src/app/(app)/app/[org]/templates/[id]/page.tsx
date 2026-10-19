import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { RESPONDENT_TYPE_LABEL, type Template, type TemplateQuestion } from "@/lib/types";
import { Flash } from "@/components/flash";
import { KIND_LABEL } from "../kinds";

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug, "viewer");
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("templates").select("*").eq("id", id).eq("organisation_id", access.org.id).maybeSingle();
  if (!data) notFound();
  const template = data as Template;

  const [{ data: qs }, { data: versions }] = await Promise.all([
    supabase.from("template_questions").select("*").eq("template_id", id).order("position"),
    supabase.from("templates").select("id, version, is_current, created_at").eq("lineage_id", template.lineage_id).order("version", { ascending: false }),
  ]);
  const questions = (qs ?? []) as TemplateQuestion[];
  const canEdit = hasRole(access.role, "manager");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/templates`} className="text-sm text-stone-500 hover:underline">← Surveys</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{template.name}</h1>
          <span className="badge bg-stone-100 text-stone-700">v{template.version}</span>
          {template.is_pulse && <span className="badge bg-sky-100 text-sky-800">Pulse</span>}
          {!template.is_current && <span className="badge bg-amber-100 text-amber-800">Old version</span>}
        </div>
        <p className="mt-1 text-sm text-stone-600">
          For {RESPONDENT_TYPE_LABEL[template.audience].toLowerCase()}s. Created {formatDate(template.created_at)}.
          {template.anonymity_choice ? " Respondents choose whether to stay anonymous." : " Answers are linked to the person."}
          {template.non_performance_statement && " Includes the non-performance statement."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/app/${slug}/templates/${id}/preview`} className="btn-secondary">Preview</Link>
          {canEdit && template.is_current && <Link href={`/app/${slug}/templates/${id}/edit`} className="btn-primary">Edit (new version)</Link>}
        </div>
      </div>

      <Flash ok={ok} error={error} />

      <div className="card">
        {template.intro && <p className="mb-4 text-stone-700">{template.intro}</p>}
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.id} className="flex gap-3 border-t border-stone-100 pt-3 first:border-0 first:pt-0">
              <span className="w-6 shrink-0 text-right text-stone-400">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {q.prompt}
                  {q.required && <span className="ml-1 text-red-600">*</span>}
                </div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {KIND_LABEL[q.kind]} · key <code className="rounded bg-stone-100 px-1">{q.key}</code>
                  {q.kind === "choice" && q.options && <> · {q.options.join(" / ")}</>}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-stone-100 pt-3 text-sm text-stone-600">
          <span className="font-medium">Thank-you message:</span> {template.thank_you}
        </p>
      </div>

      {versions && versions.length > 1 && (
        <div className="card">
          <h2 className="text-base font-semibold">Versions</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                {v.id === id ? (
                  <span className="font-medium">v{v.version}</span>
                ) : (
                  <Link href={`/app/${slug}/templates/${v.id}`} className="hover:underline">v{v.version}</Link>
                )}
                <span className="text-stone-500">{formatDate(v.created_at)}</span>
                {v.is_current && <span className="badge bg-green-100 text-green-800">Current</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
