import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { RESPONDENT_TYPE_LABEL, type Respondent, type RespondentType } from "@/lib/types";
import { Flash } from "@/components/flash";
import { createRespondent } from "./actions";
import { RespondentFields, StatusBadge, respondentStatus } from "./respondent-fields";

const TYPES = Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[];

export default async function RespondentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string; type?: string; status?: string; ok?: string; error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "staff");
  const { q, type, status, ok, error } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("respondents")
    .select("*")
    .eq("organisation_id", access.org.id)
    .order("full_name")
    .limit(500);
  if (type && TYPES.includes(type as RespondentType)) query = query.eq("type", type);
  if (q) {
    const term = q.trim().replace(/[%,()]/g, "");
    if (term) {
      const digits = term.replace(/\D/g, "");
      const parts = [`full_name.ilike.%${term}%`, `email.ilike.%${term}%`];
      if (digits.length >= 4) parts.push(`mobile.ilike.%${digits.replace(/^0/, "")}%`);
      query = query.or(parts.join(","));
    }
  }
  const { data } = await query;
  let people = (data ?? []) as Respondent[];
  if (status === "active" || status === "left" || status === "unsubscribed") {
    people = people.filter((p) => respondentStatus(p) === status);
  }

  const { count: total } = await supabase
    .from("respondents")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", access.org.id);
  const { count: active } = await supabase
    .from("respondents")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", access.org.id)
    .is("relationship_end", null)
    .is("unsubscribed_at", null)
    .eq("consent_feedback", true);

  const action = createRespondent.bind(null, slug);
  const noun = access.org.respondent_noun;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">People</h1>
          <p className="mt-1 text-sm text-stone-600">
            {total ?? 0} on the list, {active ?? 0} active. {noun.charAt(0).toUpperCase() + noun.slice(1)}s, next of kin, carers and anyone else you ask for feedback.
          </p>
        </div>
        <Link href={`/app/${slug}/respondents/import`} className="btn-secondary">Import from CSV</Link>
      </div>

      <Flash ok={ok} error={error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form className="mb-3 flex flex-wrap gap-2" method="get">
            <input name="q" className="input max-w-xs" placeholder="Search name, email or mobile" defaultValue={q ?? ""} />
            <select name="type" className="input w-auto" defaultValue={type ?? ""}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>{RESPONDENT_TYPE_LABEL[t]}</option>
              ))}
            </select>
            <select name="status" className="input w-auto" defaultValue={status ?? ""}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="left">Left</option>
              <option value="unsubscribed">Unsubscribed</option>
            </select>
            <button className="btn-secondary">Filter</button>
          </form>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 && (
                  <tr className="border-t border-stone-100">
                    <td colSpan={5} className="px-4 py-8 text-center text-stone-500">No one matches. Add someone on the right or import a CSV.</td>
                  </tr>
                )}
                {people.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100 align-top hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link href={`/app/${slug}/respondents/${p.id}`} className="font-medium text-stone-900 hover:underline">{p.full_name}</Link>
                      {p.type === "next_of_kin" && p.relates_to && <div className="text-xs text-stone-500">Next of kin to {p.relates_to}</div>}
                    </td>
                    <td className="px-4 py-3 text-stone-700">{RESPONDENT_TYPE_LABEL[p.type]}</td>
                    <td className="px-4 py-3 text-stone-700">
                      {p.email && <div className="truncate max-w-56">{p.email}</div>}
                      {p.mobile && (
                        <div>
                          {formatPhone(p.mobile)}
                          {p.whatsapp_opt_in && <span className="ml-1 text-xs text-green-700">WhatsApp</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-600">
                      {p.relationship_start && <div>Started {formatDate(p.relationship_start)}</div>}
                      {p.relationship_end && <div>Ended {formatDate(p.relationship_end)}</div>}
                      {p.event_date && <div>Event {formatDate(p.event_date)}</div>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={respondentStatus(p)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {people.length >= 500 && <p className="mt-2 text-xs text-stone-500">Showing the first 500. Use the search to narrow the list.</p>}
        </div>

        <div className="card self-start">
          <h2 className="text-lg font-semibold">Add someone</h2>
          <p className="mb-4 mt-1 text-sm text-stone-600">An email address or a mobile number is needed so we can reach them.</p>
          <form action={action} className="space-y-4">
            <RespondentFields />
            <button className="btn-primary w-full">Add</button>
          </form>
        </div>
      </div>
    </div>
  );
}
