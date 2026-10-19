import type { ConcernStatus, Response } from "@/lib/types";

/** Stat tile for dashboards and reports. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

const RATING_COLOURS = ["bg-red-500", "bg-orange-400", "bg-amber-300", "bg-lime-400", "bg-green-600"];

/** Tiny inline 1–5 distribution bar made of divs; widths proportional to counts. */
export function DistributionBar({ counts, labels }: { counts: number[]; labels?: string[] }) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="h-2.5 w-full rounded-full bg-stone-100" aria-hidden />;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-stone-100" role="img" aria-label={counts.map((c, i) => `${labels?.[i] ?? i + 1}: ${c}`).join(", ")}>
      {counts.map((c, i) =>
        c === 0 ? null : (
          <div
            key={i}
            className={RATING_COLOURS[i] ?? "bg-stone-400"}
            style={{ width: `${(c / total) * 100}%` }}
            title={`${labels?.[i] ?? i + 1}: ${c}`}
          />
        ),
      )}
    </div>
  );
}

export function SentimentBadge({ sentiment }: { sentiment: Response["sentiment"] }) {
  if (!sentiment) return <span className="badge bg-stone-100 text-stone-500">Not reviewed</span>;
  const cls =
    sentiment === "positive"
      ? "bg-green-50 text-green-800"
      : sentiment === "negative"
        ? "bg-red-50 text-red-800"
        : "bg-stone-100 text-stone-700";
  return <span className={`badge ${cls} capitalize`}>{sentiment}</span>;
}

export function ConcernBadge({ concern }: { concern: boolean }) {
  if (!concern) return null;
  return <span className="badge bg-amber-50 text-amber-800">Concern</span>;
}

export const CONCERN_STATUS_LABEL: Record<ConcernStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};

export function ConcernStatusBadge({ status }: { status: ConcernStatus }) {
  const cls =
    status === "open" ? "bg-red-50 text-red-800" : status === "in_progress" ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800";
  return <span className={`badge ${cls}`}>{CONCERN_STATUS_LABEL[status]}</span>;
}

/** Score pill for a 1–5 headline rating. */
export function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-stone-400">—</span>;
  const cls = score >= 4 ? "bg-green-50 text-green-800" : score === 3 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800";
  return <span className={`badge ${cls} tabular-nums`}>{score}/5</span>;
}

export function truncate(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Shows an answer value in words. */
export function formatAnswer(kind: string, value: unknown, options?: string[] | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "rating5") return `${value} / 5`;
  if (kind === "nps") return `${value} / 10`;
  if (kind === "yesno") return value ? "Yes" : "No";
  if (kind === "choice") return typeof value === "string" && (!options || options.includes(value)) ? value : String(value);
  return String(value);
}
