import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { ROLE_RANK, type MemberRole, type Profile } from "@/lib/types";
import { Flash } from "@/components/flash";
import { inviteMember, removeMember, updateMemberRole } from "./actions";

const ROLE_HELP: Record<MemberRole, string> = {
  viewer: "Sees anonymised results and reports only",
  staff: "Adds people, runs ad hoc sends, enters telephone responses",
  manager: "Sees who said what, handles concerns, edits surveys and settings",
  owner: "Everything, including billing-level settings",
};

interface Row {
  id: string;
  role: MemberRole;
  expires_at: string | null;
  created_at: string;
  profiles: Pick<Profile, "id" | "email" | "full_name" | "is_owner"> | null;
}

export default async function MembersPage({
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
    .from("memberships")
    .select("id, role, expires_at, created_at, profiles(id, email, full_name, is_owner)")
    .eq("organisation_id", access.org.id)
    .order("created_at");
  const rows = (data ?? []) as unknown as Row[];
  const grantable = (Object.keys(ROLE_RANK) as MemberRole[]).filter((r) => ROLE_RANK[r] <= ROLE_RANK[access.role]);
  const invite = inviteMember.bind(null, slug);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/app/${slug}/settings`} className="text-sm text-stone-500 hover:underline">← Settings</Link>
        <h1 className="mt-1 text-2xl font-semibold">Team members</h1>
        <p className="mt-1 text-sm text-stone-600">Who can sign in to {access.org.name} on Loop, and what they can see.</p>
      </div>

      <Flash ok={ok} error={error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-x-auto p-0 lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="border-t border-stone-100">
                  <td colSpan={4} className="px-4 py-8 text-center text-stone-500">No members yet.</td>
                </tr>
              )}
              {rows.map((m) => {
                const expired = !!m.expires_at && new Date(m.expires_at) < new Date();
                const isSelf = m.profiles?.id === access.session.userId;
                const canChange = ROLE_RANK[m.role] <= ROLE_RANK[access.role];
                const setRole = updateMemberRole.bind(null, slug, m.id);
                const remove = removeMember.bind(null, slug, m.id);
                return (
                  <tr key={m.id} className="border-t border-stone-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.profiles?.full_name ?? m.profiles?.email ?? "Unknown"}</div>
                      <div className="text-xs text-stone-500">{m.profiles?.email}{isSelf && " (you)"}{m.profiles?.is_owner && " · app owner"}</div>
                    </td>
                    <td className="px-4 py-3">
                      {canChange ? (
                        <form action={setRole} className="flex items-center gap-1">
                          <select name="role" className="input w-auto py-1 text-sm capitalize" defaultValue={m.role}>
                            {grantable.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                          <button className="btn-secondary px-2 py-1 text-xs">Set</button>
                        </form>
                      ) : (
                        <span className="capitalize">{m.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-700">
                      {m.expires_at ? (
                        <span className={expired ? "text-red-700" : ""}>{formatDate(m.expires_at)}{expired && " (expired)"}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canChange && (!isSelf || access.session.profile.is_owner) && (
                        <form action={remove}>
                          <button className="text-sm text-red-700 hover:underline">Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card self-start">
          <h2 className="text-base font-semibold">Invite someone</h2>
          <p className="mb-4 mt-1 text-sm text-stone-600">They get an email with a sign-in link. Set an expiry for inspectors and auditors.</p>
          <form action={invite} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select id="role" name="role" className="input capitalize" defaultValue="staff">
                {grantable.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="expires_at">Access ends <span className="font-normal text-stone-500">(optional)</span></label>
              <input id="expires_at" name="expires_at" type="date" className="input" />
            </div>
            <button className="btn-primary w-full">Send invitation</button>
          </form>
          <dl className="mt-5 space-y-1 text-xs text-stone-600">
            {grantable.map((r) => (
              <div key={r}>
                <dt className="inline font-medium capitalize text-stone-800">{r}: </dt>
                <dd className="inline">{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
