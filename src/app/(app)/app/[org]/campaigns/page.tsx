import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CHANNEL_LABEL, type Campaign, type InvitationStatus } from "@/lib/types";
import { Flash } from "@/components/flash";
import { STATUS_BADGE, TRIGGER_LABEL } from "./constants";

interface Counts {
  scheduled: number;
  sent: number;
  answered: number;
}

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "staff");
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const [{ data: rows }, { data: invs }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("*, templates(name)")
      .eq("organisation_id", access.org.id)
      .order("created_at", { ascending: false }),
    supabase.from("invitations").select("campaign_id, status").eq("organisation_id", access.org.id),
  ]);
  const campaigns = (rows ?? []) as Array<Campaign & { templates: { name: string } | null }>;

  const counts = new Map<string, Counts>();
  for (const i of invs ?? []) {
    const c = counts.get(i.campaign_id) ?? { scheduled: 0, sent: 0, answered: 0 };
    const s = i.status as InvitationStatus;
    if (s === "scheduled") c.scheduled++;
    else if (s === "answered") {
      c.sent++;
      c.answered++;
    } else if (s === "sent" || s === "delivered" || s === "opened" || s === "bounced" || s === "failed") c.sent++;
    counts.set(i.campaign_id, c);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-stone-600">Who gets asked, with which survey, and when.</p>
        </div>
        <Link href={`/app/${slug}/campaigns/new`} className="btn-primary">New campaign</Link>
      </div>

      <Flash ok={ok} error={error} />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">Channels</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Queued</th>
              <th className="px-4 py-3 text-right">Sent</th>
              <th className="px-4 py-3 text-right">Answered</th>
              <th className="px-4 py-3 text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr className="border-t border-stone-100">
                <td colSpan={8} className="px-4 py-8 text-center text-stone-500">No campaigns yet.</td>
              </tr>
            )}
            {campaigns.map((c) => {
              const n = counts.get(c.id) ?? { scheduled: 0, sent: 0, answered: 0 };
              const rate = n.sent > 0 ? Math.round((n.answered / n.sent) * 100) : null;
              return (
                <tr key={c.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/app/${slug}/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <div className="text-xs text-stone-500">{c.templates?.name ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-stone-700">{TRIGGER_LABEL[c.trigger_kind]}</td>
                  <td className="px-4 py-3 text-stone-700">{c.channels.map((ch) => CHANNEL_LABEL[ch]).join(" → ")}</td>
                  <td className="px-4 py-3"><span className={`badge ${STATUS_BADGE[c.status]} capitalize`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{n.scheduled}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{n.sent}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{n.answered}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{rate === null ? "—" : `${rate}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
