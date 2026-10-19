import { formatDate } from "@/lib/format";
import { collectAnswers, fmtMean, fmtNps, fmtPct, mean, nps, responseRate, themeCounts } from "@/lib/stats";
import { createClient } from "@/lib/supabase/server";
import { loadReport } from "../load";
import { BigNumber, ReportSection, ReportShell } from "../report-shell";

export default async function TeamReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { org: slug } = await params;
  const { access, data, periodLabel } = await loadReport(slug, await searchParams);

  const rate = responseRate(data.invitations);
  const overall = mean(collectAnswers(data.responses, data.questionsByTemplate, "rating5"));
  const npsResult = nps(collectAnswers(data.responses, data.questionsByTemplate, "nps"));
  const themes = themeCounts(data.responses).slice(0, 8);
  const positives = data.responses.filter((r) => r.sentiment === "positive" && r.free_text && r.free_text.trim()).slice(0, 8);

  // Open concerns right now (not period-bound); managers only via RLS
  let openConcerns: number | null = null;
  if (access.canSeeIdentity) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("concerns")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", access.org.id)
      .neq("status", "closed");
    openConcerns = count ?? 0;
  }

  return (
    <ReportShell slug={slug} title="Team summary" orgName={access.org.short_name ?? access.org.name} periodLabel={periodLabel}>
      <ReportSection title="The numbers">
        <div className={`grid gap-3 sm:grid-cols-2 ${openConcerns === null ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
          <BigNumber label="Responses" value={String(data.responses.length)} />
          <BigNumber label="Response rate" value={fmtPct(rate.rate)} />
          <BigNumber label="Average rating" value={fmtMean(overall)} hint="out of 5" />
          <BigNumber label="Would recommend" value={fmtNps(npsResult.score)} hint="NPS" />
          {openConcerns !== null && <BigNumber label="Open concerns" value={String(openConcerns)} hint="right now" />}
        </div>
      </ReportSection>

      <ReportSection title="What people are talking about">
        {themes.length === 0 ? (
          <p className="text-sm text-stone-500">No themes picked out yet. Themes appear once comments have been reviewed.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {themes.map((t) => (
              <li key={t.key} className="rounded-full border border-stone-200 px-3 py-1 text-sm">
                {t.key} <span className="ml-1 text-stone-500">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </ReportSection>

      <ReportSection title="Things people said">
        {positives.length === 0 ? (
          <p className="text-sm text-stone-500">No positive comments reviewed in this period yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {positives.map((r) => (
              <blockquote key={r.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <p className="text-base text-stone-800">“{r.free_text!.trim()}”</p>
                <footer className="mt-2 text-xs text-stone-500">{formatDate(r.created_at)}</footer>
              </blockquote>
            ))}
          </div>
        )}
      </ReportSection>
    </ReportShell>
  );
}
