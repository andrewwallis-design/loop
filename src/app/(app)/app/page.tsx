import { redirect } from "next/navigation";
import { listOrganisations, requireSession } from "@/lib/auth";

export default async function AppIndex() {
  const session = await requireSession();
  const orgs = await listOrganisations(session);
  if (orgs.length > 0) redirect(`/app/${orgs[0].org.slug}`);
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card max-w-md text-center">
        <h1 className="text-xl font-semibold">No organisations yet</h1>
        <p className="mt-2 text-sm text-stone-600">
          Your account ({session.profile.email}) isn’t a member of any organisation on Loop.
          Ask the owner to add you.
        </p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button className="btn-secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
