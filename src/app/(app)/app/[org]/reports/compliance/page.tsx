import { formatDate } from "@/lib/format";
import {
  CQC_KEY_QUESTION,
  CQC_ORDER,
  collectAnswers,
  concernReasonLabel,
  daysBetween,
  fmtMean,
  fmtNps,
  fmtPct,
  groupByQuestion,
  mean,
  nps,
  responseRate,
  type QuestionStat,
} from "@/lib/stats";
import { CONCERN_STATUS_LABEL, DistributionBar } from "@/components/feedback-ui";
import { loadReport } from "../load";
import { BigNumber, ReportSection, ReportShell } from "../report-shell";

function QuestionTable({ rows }: { rows: Array<QuestionStat & { template: string }> }) {
  if (rows.length === 0) return <p className="text-sm text-stone-500">No scored answers in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
          <th className="py-2">Question</th>
          <th className="py-2">Survey</th>
          <th className="py-2 text-right">n</th>
          <th className="py-2 text-right">Result</th>
          <th className="py-2 pl-4">Spread</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={`${s.template}-${s.key}`} className="border-t border-stone-100">
            <td className="py-2 pr-3">{s.prompt}</td>
            <td className="py-2 pr-3 text-stone-500">{s.template}</td>
            <td className="py-2 text-right tabular-nums">{s.n}</td>
            <td className="py-2 text-right font-medium tabular-nums">
              {s.kind === "rating5" && `${fmtMean(s.mean)} / 5`}
              {s.kind === "nps" && `NPS ${fmtNps(s.nps?.score ?? null)}`}
              {s.kind === "yesno" && `${fmtPct(s.n ? Math.round(((s.yes ?? 0) / s.n) * 100) : null)} yes`}
              {s.kind === "choice" && "—"}
            </td>
            <td className="w-36 py-2 pl-4">{s.kind === "rating5" ? <DistributionBar counts={s.distribution} /> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ComplianceReportPage({
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

  // Per-question rows across every template that had responses in the period
  const templateName = new Map(data.templates.map((t) => [t.id, t.name]));
  const rows: Array<QuestionStat & { template: string }> = [];
  for (const t of data.templates) {
    const qs = data.questionsByTemplate.get(t.id) ?? [];
    const stats = groupByQuestion(qs, data.responses).filter((s) => s.n > 0);
    for (const s of stats) rows.push({ ...s, template: templateName.get(t.id) ?? "" });
  }

  const byCqc = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = CQC_KEY_QUESTION[r.key] ?? "Other";
    byCqc.set(k, [...(byCqc.get(k) ?? []), r]);
  }

  const verbatims = data.responses.filter((r) => r.free_text && r.free_text.trim());
  const concernsVisible = access.canSeeIdentity;

  return (
    <ReportShell slug={slug} title="Feedback compliance report" orgName={access.org.name} periodLabel={periodLabel}>
      <ReportSection title="Headline">
        <div className="grid gap-3 sm:grid-cols-4">
          <BigNumber label="Responses" value={String(data.responses.length)} />
          <BigNumber label="Response rate" value={fmtPct(rate.rate)} hint={`${rate.answered} of ${rate.sent} invitations`} />
          <BigNumber label="Mean overall" value={fmtMean(overall)} hint="all 1–5 answers" />
          <BigNumber label="NPS" value={fmtNps(npsResult.score)} hint={npsResult.n ? `${npsResult.n} scores` : undefined} />
        </div>
        <p className="mt-3 text-sm text-stone-600">
          Feedback was gathered by email, WhatsApp, QR code, telephone and paper form from {access.org.respondent_noun}s, families and staff.
          People could answer anonymously; any response rated 2 or below, or asking for contact, is raised as a concern and must be closed with a note.
        </p>
      </ReportSection>

      <ReportSection title="Every question">
        <QuestionTable rows={rows} />
      </ReportSection>

      <ReportSection title="By CQC key question">
        <div className="space-y-5">
          {CQC_ORDER.filter((k) => byCqc.has(k)).map((k) => (
            <div key={k}>
              <h3 className="font-semibold text-stone-800">{k}</h3>
              <div className="mt-1">
                <QuestionTable rows={byCqc.get(k)!} />
              </div>
            </div>
          ))}
          {byCqc.size === 0 && <p className="text-sm text-stone-500">No scored answers in this period.</p>}
        </div>
      </ReportSection>

      <ReportSection title="Concerns log">
        {!concernsVisible ? (
          <p className="text-sm text-stone-500">The concerns log is available to managers.</p>
        ) : data.concerns.length === 0 ? (
          <p className="text-sm text-stone-500">No concerns were raised in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2">Raised</th>
                <th className="py-2">Reason</th>
                <th className="py-2">Summary</th>
                <th className="py-2">Status</th>
                <th className="py-2">Closed</th>
                <th className="py-2 text-right">Days</th>
                <th className="py-2">Closure note</th>
              </tr>
            </thead>
            <tbody>
              {data.concerns.map((c) => (
                <tr key={c.id} className="border-t border-stone-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-2">{formatDate(c.created_at)}</td>
                  <td className="whitespace-nowrap py-2 pr-2">{concernReasonLabel(c.reason)}</td>
                  <td className="py-2 pr-2 text-stone-700">{c.summary ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-2">{CONCERN_STATUS_LABEL[c.status]}</td>
                  <td className="whitespace-nowrap py-2 pr-2">{c.closed_at ? formatDate(c.closed_at) : "—"}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{c.closed_at ? daysBetween(c.created_at, c.closed_at) : daysBetween(c.created_at)}</td>
                  <td className="py-2 text-stone-700">{c.closure_note ?? <span className="text-stone-400">Not yet closed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>

      <ReportSection title="Appendix: what people said">
        {verbatims.length === 0 ? (
          <p className="text-sm text-stone-500">No written comments in this period.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {verbatims.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-sm text-stone-800">“{r.free_text!.trim()}”</p>
                <div className="mt-1 text-xs text-stone-500">
                  {formatDate(r.created_at)} · {templateName.get(r.template_id) ?? "Survey"}
                  {r.sentiment && <> · {r.sentiment}</>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ReportSection>
    </ReportShell>
  );
}
