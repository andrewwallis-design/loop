"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLE_RANK, type MemberRole } from "@/lib/types";

const items: Array<{ href: string; label: string; min: MemberRole }> = [
  { href: "", label: "Dashboard", min: "viewer" },
  { href: "/concerns", label: "Concerns", min: "manager" },
  { href: "/responses", label: "Responses", min: "viewer" },
  { href: "/campaigns", label: "Campaigns", min: "staff" },
  { href: "/respondents", label: "People", min: "staff" },
  { href: "/templates", label: "Surveys", min: "viewer" },
  { href: "/broadcasts", label: "Broadcasts", min: "manager" },
  { href: "/reports", label: "Reports", min: "viewer" },
  { href: "/settings", label: "Settings", min: "manager" },
];

export function NavLinks({ slug, role, horizontal }: { slug: string; role: MemberRole; horizontal?: boolean }) {
  const pathname = usePathname();
  const base = `/app/${slug}`;
  return (
    <ul className={horizontal ? "flex" : "flex flex-col p-2"}>
      {items
        .filter((i) => ROLE_RANK[role] >= ROLE_RANK[i.min])
        .map((i) => {
          const href = `${base}${i.href}`;
          const active = i.href === "" ? pathname === base : pathname.startsWith(href);
          return (
            <li key={i.href}>
              <Link
                href={href}
                className={
                  (horizontal ? "block whitespace-nowrap px-3 py-2 text-sm " : "block rounded-lg px-3 py-2 text-sm ") +
                  (active ? "bg-stone-100 font-medium text-stone-900" : "text-stone-600 hover:bg-stone-50 hover:text-stone-900")
                }
              >
                {i.label}
              </Link>
            </li>
          );
        })}
    </ul>
  );
}
