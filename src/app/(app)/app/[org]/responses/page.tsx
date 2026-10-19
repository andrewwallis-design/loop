import Link from "next/link";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { Response, Template, TemplateQuestion } from "@/lib/types";
import {
  CHANNEL_OR_SOURCE_LABEL,
  channelOf,
  headlineScore,
  indexQuestions,
  parsePeriod,
  periodStart,
  type PeriodDays,
} from "@/lib/stats";
import { ConcernBadge, ScorePill, SentimentBadge, truncate } from "@/components/feedback-ui";

const PERIODS: Array<{ days: PeriodDays; label: string }> = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

export default async function ResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ template?: string; period?: string; concern?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug);
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const templateFilter = sp.template && /^[0-9a-f-]{36}$/i.test(sp.template) ? sp.template : "";
  const concernOnly = sp.concern === "1";
  const supabase = await createClient();

  const { data: templatesData } = await supabase
    .from("templates")
    .select("*")
    .eq("organisation_id", access.org.id)
    .order("name");
  const templates = (templatesData ?? []) as Template[];
  const templateName = new Map(templates.map((t) => [t.id, t.name]));

  let query = supabase
    .from("responses")
    .select("*")
    .eq("organisation_id", access.org.id)
    .gte("created_at", periodStart(period).toISOString())
    .order("created_at", { ascending: false })
    .limit(500);
  if (templateFilter) query = query.eq("template_id", templateFilter);
  if (concernOnly) query = query.eq("concern", true);
  const { data: responsesData } = await query;
  const responses = (responsesData ?? []) as Response[];

  const templateIds = [...new Set(responses.map((r) => r.template_id))];
  const { data: questionsData } = templateIds.length
    ? await supabase.from("template_questions").select("*").in("template_id", templateIds)
    : { data: [] };
  const questionsByTemplate = indexQuestions((questionsData ?? []) as TemplateQuestion[]);

  const invitationIds = responses.map((r) => r.invitation_id).filter((x): x is string => !!x);
  const invitationChannel = new Map<string, string>();
  if (invitationIds.length && hasRole(access.role, "staff")) {
    const { data: inv } = await supabase.from("invitations").select("id, channel").in("id", invitationIds);
    for (const i of inv ?? []) invitationChannel.set(i.id, i.channel);
  }

  // Names only for managers, and only where the respondent agreed to be contactable
  const names = new Map<string, string>();
  if (access.canSeeIdentity) {
    const ids = [...new Set(responses.filter((r) => r.contactable && r.respondent_id).map((r) => r.respondent_id!))];
    if (ids.length) {
      const { data: people } = await supabase.from("respondents").select("id, full_name").in("id", ids);
      for (const p of people ?? []) names.set(p.id, p.full_name);
    }
  }

  const canRecord = hasRole(access.role, "staff");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Responses</h1>
          <p className="mt-1 text-sm text-stone-600">
            {responses.length} {responses.length === 1 ? "response" : "responses"}
            {access.canSeeIdentity ? "" : " · names are hidden for your role"}
          </p>
        </div>
        {canRecord && (
          <Link href={`/app/${slug}/responses/new`} className="btn-primary">Record a response by hand</Link>
        )}
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="template">Survey</label>
          <select id="template" name="template" className="input" defaultValue={templateFilter}>
            <option value="">All surveys</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.version > 1 ? ` (v${t.version})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="period">Period</label>
          <select id="period" name="period" className="input" defaultValue={String(period)}>
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>{p.label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="concern" value="1" defaultChecked={concernOnly} />
          Concerns only
        </label>
        <button className="btn-secondary">Apply</button>
        {(templateFilter || concernOnly || period !== 90) && (
          <Link href={`/app/${slug}/responses`} className="pb-2 text-sm text-stone-500 hover:underline">Clear</Link>
        )}
      </form>

      <div className="card overflow-x-auto p-0">
        {responses.length === 0 ? (
          <p className="p-5 text-sm text-stone-500">No responses match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Survey</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Via</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Sentiment</th>
                <th className="px-4 py-3">Comment</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => {
                const name = access.canSeeIdentity && r.contactable && r.respondent_id ? names.get(r.respondent_id) : null;
                const channel = channelOf(r, invitationChannel);
                return (
                  <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/app/${slug}/responses/${r.id}`} className="text-brand hover:underline">
                        {formatDate(r.created_at)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{templateName.get(r.template_id) ?? "—"}</td>
                    <td className="px-4 py-3">{name ?? <span className="text-stone-500">Anonymous</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-600">{CHANNEL_OR_SOURCE_LABEL[channel] ?? channel}</td>
                    <td className="px-4 py-3">
                      <ScorePill score={headlineScore(r, questionsByTemplate.get(r.template_id))} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <SentimentBadge sentiment={r.sentiment} />
                        <ConcernBadge concern={r.concern} />
                      </div>
                    </td>
                    <td className="max-w-md px-4 py-3 text-stone-700">{truncate(r.free_text, 100) || <span className="text-stone-400">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
