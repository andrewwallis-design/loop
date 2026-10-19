import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { reportPeriodOptions } from "@/lib/stats";
import { formatDate } from "@/lib/format";

const REPORTS = [
  {
    kind: "compliance",
    title: "Compliance report",
    blurb: "For CQC and the board: headline numbers, every question, results grouped by CQC key question, the concerns log with closure notes, and anonymised comments.",
  },
  {
    kind: "team",
    title: "Team summary",
    blurb: "One page for the staff noticeboard: the big numbers, what people are talking about, and eight positive comments.",
  },
];

export default async function ReportsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await requireOrg(slug);
  const periods = reportPeriodOptions();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="mt-1 text-sm text-stone-600">Pick a report and a period. Reports open as a printable page; use the button on the report to save a PDF. Nobody is named in any report.</p>
      </div>

      <form method="get" action={`/app/${slug}/reports/go`} className="card space-y-5">
        <fieldset>
          <legend className="label">Report</legend>
          <div className="space-y-2">
            {REPORTS.map((r, i) => (
              <label key={r.kind} className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-3 hover:bg-stone-50">
                <input type="radio" name="kind" value={r.kind} defaultChecked={i === 0} className="mt-1" />
                <span>
                  <span className="block font-medium">{r.title}</span>
                  <span className="block text-sm text-stone-600">{r.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="period">Period</label>
          <select id="period" name="period" className="input" defaultValue={`${periods[0].from}_${periods[0].to}`}>
            {periods.map((p) => (
              <option key={p.label} value={`${p.from}_${p.to}`}>
                {p.label} ({formatDate(p.from)} – {formatDate(new Date(new Date(p.to).getTime() - 86_400_000))})
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary">Open report</button>
        </div>
      </form>

      <div className="text-sm text-stone-500">
        Quick links:{" "}
        {periods.slice(0, 3).map((p, i) => (
          <span key={p.label}>
            {i > 0 && " · "}
            <Link href={`/app/${slug}/reports/compliance?from=${p.from}&to=${p.to}`} className="text-brand hover:underline">Compliance, {p.label.toLowerCase()}</Link>
          </span>
        ))}
      </div>
    </div>
  );
}
