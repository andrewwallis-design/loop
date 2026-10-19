import Link from "next/link";
import { hasRole, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import {
  CHANNEL_OR_SOURCE_LABEL,
  channelOf,
  collectAnswers,
  countBy,
  fmtMean,
  fmtNps,
  fmtPct,
  groupByQuestion,
  loadFeedbackData,
  mean,
  nps,
  parsePeriod,
  periodStart,
  responseRate,
  type PeriodDays,
} from "@/lib/stats";
import { DistributionBar, SentimentBadge, StatTile, truncate } from "@/components/feedback-ui";

const PERIODS: Array<{ days: PeriodDays; label: string }> = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug);
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam);
  const supabase = await createClient();
  const data = await loadFeedbackData(supabase, access.org.id, periodStart(period));
  const isManager = hasRole(access.role, "manager");

  const rate = responseRate(data.invitations);
  const overall = mean(collectAnswers(data.responses, data.questionsByTemplate, "rating5"));
  const npsResult = nps(collectAnswers(data.responses, data.questionsByTemplate, "nps"));

  // Open concerns are not limited to the period
  let openConcerns: number | null = null;
  if (isManager) {
    const { count } = await supabase
      .from("concerns")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", access.org.id)
      .neq("status", "closed");
    openConcerns = count ?? 0;
  }

  // Per-question breakdown for the current client-facing templates that have responses in the period
  const currentTemplates = data.templates.filter((t) => t.is_current && !t.is_pulse);
  const breakdown = currentTemplates
    .map((t) => ({
      template: t,
      responses: data.responses.filter((r) => r.template_id === t.id),
      stats: groupByQuestion(data.questionsByTemplate.get(t.id) ?? [], data.responses).filter((s) => s.kind === "rating5"),
    }))
    .filter((b) => b.responses.length > 0 && b.stats.length > 0);

  const byChannel = countBy(data.responses, (r) => channelOf(r, data.invitationChannel));
  const recentComments = data.responses.filter((r) => r.free_text && r.free_text.trim().length > 0).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-600">
            {access.org.name} · last {PERIODS.find((p) => p.days === period)?.label}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.days}
              href={`/app/${slug}?period=${p.days}`}
              className={`rounded-md px-3 py-1 ${p.days === period ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50"}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className={`grid gap-4 sm:grid-cols-2 ${isManager ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <StatTile label="Responses" value={String(data.responses.length)} hint="received in the period" />
        <StatTile label="Response rate" value={fmtPct(rate.rate)} hint={`${rate.answered} of ${rate.sent} invitations answered`} />
        <StatTile label="Average rating" value={fmtMean(overall)} hint="mean of all 1–5 answers" />
        <StatTile label="NPS" value={fmtNps(npsResult.score)} hint={npsResult.n ? `${npsResult.promoters} promoters, ${npsResult.detractors} detractors of ${npsResult.n}` : "no scores yet"} />
        {isManager && (
          <Link href={`/app/${slug}/concerns`} className="block">
            <div className={`card h-full ${openConcerns ? "border-amber-300" : ""}`}>
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Open concerns</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{openConcerns ?? 0}</div>
              <div className="mt-1 text-xs text-brand underline">View the queue</div>
            </div>
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {breakdown.length === 0 ? (
            <div className="card">
              <h2 className="text-lg font-semibold">By question</h2>
              <p className="mt-2 text-sm text-stone-500">No survey responses in this period yet.</p>
            </div>
          ) : (
            breakdown.map((b) => (
              <div key={b.template.id} className="card">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-semibold">{b.template.name}</h2>
                  <span className="text-sm text-stone-500">{b.responses.length} responses</span>
                </div>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                      <th className="py-2">Question</th>
                      <th className="py-2 text-right">n</th>
                      <th className="py-2 text-right">Mean</th>
                      <th className="py-2 pl-4">1 – 5</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.stats.map((s) => (
                      <tr key={s.key} className="border-t border-stone-100">
                        <td className="py-2 pr-3">{s.prompt}</td>
                        <td className="py-2 text-right tabular-nums">{s.n}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{fmtMean(s.mean)}</td>
                        <td className="w-40 py-2 pl-4">
                          <DistributionBar counts={s.distribution} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold">By channel</h2>
            {byChannel.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Nothing yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {byChannel.map((c) => (
                    <tr key={c.key} className="border-t border-stone-100">
                      <td className="py-2">{CHANNEL_OR_SOURCE_LABEL[c.key] ?? c.key}</td>
                      <td className="py-2 text-right tabular-nums">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Recent comments</h2>
              <Link href={`/app/${slug}/responses`} className="text-sm text-brand hover:underline">All responses</Link>
            </div>
            {recentComments.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">No comments yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-stone-100">
                {recentComments.map((r) => (
                  <li key={r.id} className="py-3">
                    <Link href={`/app/${slug}/responses/${r.id}`} className="block hover:underline">
                      <p className="text-sm text-stone-800">“{truncate(r.free_text, 160)}”</p>
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
                      <span>{formatDate(r.created_at)}</span>
                      <SentimentBadge sentiment={r.sentiment} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
