import Link from "next/link";
import { PrintButton } from "@/components/print-button";

/**
 * Printable wrapper for reports: hides the app chrome when printing, white
 * background, A4-friendly margins.
 */
export function ReportShell({
  slug,
  title,
  orgName,
  periodLabel,
  children,
}: {
  slug: string;
  title: string;
  orgName: string;
  periodLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="report">
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm; }
          body { background: #fff !important; color: #111 !important; }
          aside, header, nav, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
          .report { max-width: none !important; }
          .report .card { box-shadow: none !important; border-color: #ddd !important; break-inside: avoid; }
          .report table { break-inside: auto; }
          .report tr { break-inside: avoid; }
          .report h2 { break-after: avoid; }
          .report a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
          <Link href={`/app/${slug}/reports`} className="text-sm text-stone-500 hover:underline">← Reports</Link>
          <PrintButton />
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 print:rounded-none print:border-0 print:p-0 sm:p-10">
          <header className="border-b border-stone-200 pb-4">
            <div className="text-sm font-medium uppercase tracking-wide text-stone-500">{orgName}</div>
            <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-stone-600">{periodLabel}</p>
          </header>
          <div className="mt-6 space-y-8">{children}</div>
          <footer className="mt-10 border-t border-stone-200 pt-3 text-xs text-stone-500">
            Produced by Loop. Responses are anonymised; no names appear in this report.
          </footer>
        </div>
      </div>
    </div>
  );
}

export function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function BigNumber({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}
