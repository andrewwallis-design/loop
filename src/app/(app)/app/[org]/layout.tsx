import Link from "next/link";
import { listOrganisations, requireOrg } from "@/lib/auth";
import { OrgSwitcher } from "@/components/org-switcher";
import { NavLinks } from "@/components/nav-links";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug);
  const orgs = await listOrganisations(access.session);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="border-b border-stone-200 p-4">
          <Link href="/app" className="text-lg font-semibold tracking-tight">Loop</Link>
          <div className="mt-3">
            <OrgSwitcher
              current={slug}
              orgs={orgs.map((o) => ({ slug: o.org.slug, name: o.org.name }))}
              canAdd={access.session.profile.is_owner}
            />
          </div>
        </div>
        <NavLinks slug={slug} role={access.role} />
        <div className="mt-auto border-t border-stone-200 p-4 text-xs text-stone-500">
          <div className="truncate">{access.session.profile.email}</div>
          <div className="mt-1 capitalize">{access.role}</div>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="text-stone-600 underline hover:text-stone-900">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden">
          <Link href="/app" className="font-semibold">Loop</Link>
          <OrgSwitcher
            current={slug}
            orgs={orgs.map((o) => ({ slug: o.org.slug, name: o.org.name }))}
            canAdd={access.session.profile.is_owner}
          />
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-white px-2 md:hidden">
          <NavLinks slug={slug} role={access.role} horizontal />
        </nav>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
