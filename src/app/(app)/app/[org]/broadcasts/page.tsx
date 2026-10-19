import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { CHANNEL_LABEL, RESPONDENT_TYPE_LABEL, type Broadcast } from "@/lib/types";
import { Flash } from "@/components/flash";

function StatusBadge({ status }: { status: Broadcast["status"] }) {
  const cls = status === "sent" ? "bg-green-50 text-green-800" : status === "sending" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-700";
  return <span className={`badge ${cls} capitalize`}>{status}</span>;
}

export default async function BroadcastsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "manager");
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("organisation_id", access.org.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const broadcasts = (data ?? []) as Broadcast[];

  // Recipient counts per broadcast
  const counts = new Map<string, { total: number; sent: number; failed: number }>();
  if (broadcasts.length) {
    const { data: recips } = await supabase
      .from("broadcast_recipients")
      .select("broadcast_id, status")
      .in("broadcast_id", broadcasts.map((b) => b.id));
    for (const r of recips ?? []) {
      const c = counts.get(r.broadcast_id) ?? { total: 0, sent: 0, failed: 0 };
      c.total += 1;
      if (r.status === "sent" || r.status === "delivered") c.sent += 1;
      if (r.status === "failed" || r.status === "bounced") c.failed += 1;
      counts.set(r.broadcast_id, c);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="mt-1 text-sm text-stone-600">Information out: newsletters, notices and service updates to your {access.org.respondent_noun}s and carers.</p>
        </div>
        <Link href={`/app/${slug}/broadcasts/new`} className="btn-primary">New broadcast</Link>
      </div>

      <Flash ok={ok} error={error} />

      <div className="card overflow-x-auto p-0">
        {broadcasts.length === 0 ? (
          <p className="p-5 text-sm text-stone-500">No broadcasts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Channels</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3 text-right">Recipients</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => {
                const c = counts.get(b.id);
                return (
                  <tr key={b.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link href={`/app/${slug}/broadcasts/${b.id}`} className="font-medium text-brand hover:underline">{b.subject}</Link>
                      {b.is_marketing && <span className="badge ml-2 bg-purple-50 text-purple-800">News</span>}
                    </td>
                    <td className="px-4 py-3 text-stone-700">{b.audience_types.map((t) => RESPONDENT_TYPE_LABEL[t]).join(", ")}</td>
                    <td className="px-4 py-3 text-stone-700">{b.channels.map((ch) => CHANNEL_LABEL[ch]).join(", ")}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3">{b.sent_at ? formatDate(b.sent_at) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {c ? (
                        <>
                          {c.sent} sent{c.failed > 0 && <span className="text-red-700">, {c.failed} failed</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
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
