import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { Concern, ConcernStatus } from "@/lib/types";
import { concernReasonLabel, daysBetween, periodStart } from "@/lib/stats";
import { truncate } from "@/components/feedback-ui";

const GROUPS: Array<{ status: ConcernStatus; title: string; empty: string }> = [
  { status: "open", title: "Open", empty: "Nothing waiting. Good." },
  { status: "in_progress", title: "In progress", empty: "Nothing being worked on." },
  { status: "closed", title: "Closed in the last 30 days", empty: "Nothing closed recently." },
];

export default async function ConcernsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "manager");
  const supabase = await createClient();

  const since = periodStart(30).toISOString();
  const { data } = await supabase
    .from("concerns")
    .select("*")
    .eq("organisation_id", access.org.id)
    .or(`status.neq.closed,closed_at.gte.${since}`)
    .order("created_at", { ascending: false });
  const concerns = (data ?? []) as Concern[];

  const ownerIds = [...new Set(concerns.map((c) => c.owner_user_id).filter((x): x is string => !!x))];
  const owners = new Map<string, string>();
  if (ownerIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ownerIds);
    for (const p of profiles ?? []) owners.set(p.id, p.full_name ?? p.email);
  }

  const openCount = concerns.filter((c) => c.status !== "closed").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Concerns</h1>
        <p className="mt-1 text-sm text-stone-600">
          {openCount === 0 ? "No open concerns." : `${openCount} ${openCount === 1 ? "concern needs" : "concerns need"} attention.`} Every concern
          needs an owner and a closure note.
        </p>
      </div>

      {GROUPS.map((g) => {
        const rows = concerns.filter((c) => c.status === g.status);
        const closed = g.status === "closed";
        const body =
          rows.length === 0 ? (
            <p className="p-5 text-sm text-stone-500">{g.empty}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-3">Raised</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 text-right">{closed ? "Days to close" : "Days open"}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const days = closed ? daysBetween(c.created_at, c.closed_at ?? undefined) : daysBetween(c.created_at);
                  return (
                    <tr key={c.id} className="border-t border-stone-100 hover:bg-stone-50">
                      <td className="whitespace-nowrap px-4 py-3">{formatDate(c.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{concernReasonLabel(c.reason)}</td>
                      <td className="max-w-lg px-4 py-3 text-stone-700">{truncate(c.summary, 140) || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {c.owner_user_id ? owners.get(c.owner_user_id) ?? "—" : <span className="text-red-700">Unowned</span>}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${!closed && days >= 5 ? "font-semibold text-red-700" : ""}`}>{days}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/app/${slug}/concerns/${c.id}`} className="text-brand hover:underline">Open</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );

        if (closed) {
          return (
            <details key={g.status} className="card overflow-x-auto p-0">
              <summary className="cursor-pointer px-5 py-4 text-lg font-semibold">
                {g.title} <span className="ml-2 text-sm font-normal text-stone-500">{rows.length}</span>
              </summary>
              {body}
            </details>
          );
        }
        return (
          <section key={g.status} className="card overflow-x-auto p-0">
            <h2 className="px-5 py-4 text-lg font-semibold">
              {g.title} <span className="ml-2 text-sm font-normal text-stone-500">{rows.length}</span>
            </h2>
            {body}
          </section>
        );
      })}
    </div>
  );
}
