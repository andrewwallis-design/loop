import Link from "next/link";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RESPONDENT_TYPE_LABEL, type Template } from "@/lib/types";
import { Flash } from "@/components/flash";

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "viewer");
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("templates")
    .select("*, template_questions(count)")
    .eq("organisation_id", access.org.id)
    .eq("is_current", true)
    .order("is_pulse")
    .order("name");
  const templates = (data ?? []) as Array<Template & { template_questions: Array<{ count: number }> }>;
  const canEdit = hasRole(access.role, "manager");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Surveys</h1>
          <p className="mt-1 text-sm text-stone-600">
            The question sets you send. Editing a survey creates a new version so past answers still line up with the questions people saw.
          </p>
        </div>
        {canEdit && <Link href={`/app/${slug}/templates/new`} className="btn-primary">New survey</Link>}
      </div>

      <Flash ok={ok} error={error} />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Audience</th>
              <th className="px-4 py-3">Questions</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr className="border-t border-stone-100">
                <td colSpan={5} className="px-4 py-8 text-center text-stone-500">No surveys yet.</td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="px-4 py-3">
                  <Link href={`/app/${slug}/templates/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                  {t.is_pulse && <span className="badge ml-2 bg-sky-100 text-sky-800">Pulse</span>}
                  {access.org.kiosk_template_id === t.id && <span className="badge ml-2 bg-stone-200 text-stone-700">Kiosk</span>}
                </td>
                <td className="px-4 py-3 text-stone-700">{RESPONDENT_TYPE_LABEL[t.audience]}</td>
                <td className="px-4 py-3 text-stone-700">{t.template_questions?.[0]?.count ?? 0}</td>
                <td className="px-4 py-3 text-stone-700">v{t.version}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/app/${slug}/templates/${t.id}/preview`} className="text-sm text-stone-600 hover:underline">Preview</Link>
                  {canEdit && (
                    <Link href={`/app/${slug}/templates/${t.id}/edit`} className="ml-3 text-sm text-stone-600 hover:underline">Edit</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
