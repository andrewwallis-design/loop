"use client";

import { useRouter } from "next/navigation";

export function OrgSwitcher({
  current,
  orgs,
  canAdd,
}: {
  current: string;
  orgs: Array<{ slug: string; name: string }>;
  canAdd: boolean;
}) {
  const router = useRouter();
  return (
    <select
      className="input text-sm"
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v === "__add" ? `/app/${current}/settings/organisations/new` : `/app/${v}`);
      }}
    >
      {orgs.map((o) => (
        <option key={o.slug} value={o.slug}>{o.name}</option>
      ))}
      {canAdd && <option value="__add">+ Add an organisation…</option>}
    </select>
  );
}
