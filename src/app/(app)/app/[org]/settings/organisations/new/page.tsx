import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { Flash } from "@/components/flash";
import { createOrganisation } from "./actions";

export default async function NewOrganisationPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "viewer");
  if (!access.session.profile.is_owner) redirect(`/app/${slug}`);
  const { error } = await searchParams;
  const action = createOrganisation.bind(null, slug);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/app/${slug}/settings`} className="text-sm text-stone-500 hover:underline">← Settings</Link>
        <h1 className="mt-1 text-2xl font-semibold">New organisation</h1>
        <p className="mt-1 text-sm text-stone-600">
          Each organisation has its own people, surveys and results. Nothing is shared between them.
        </p>
      </div>
      <Flash error={error} />
      <form action={action} className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" className="input" required placeholder="Fit 2 Fly Medicals" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="short_name">Short name <span className="font-normal text-stone-500">(in messages)</span></label>
            <input id="short_name" name="short_name" className="input" placeholder="Fit 2 Fly" />
          </div>
          <div>
            <label className="label" htmlFor="slug">Short link name <span className="font-normal text-stone-500">(optional)</span></label>
            <input id="slug" name="slug" className="input font-mono" placeholder="made from the name" pattern="[a-z0-9-]*" />
            <p className="mt-1 text-xs text-stone-500">Used in links such as /k/fit2fly. Cannot be changed later.</p>
          </div>
          <div>
            <label className="label" htmlFor="respondent_noun">What you call the people you serve</label>
            <select id="respondent_noun" name="respondent_noun" className="input" defaultValue="client">
              <option value="client">Clients</option>
              <option value="pilot">Pilots</option>
              <option value="patient">Patients</option>
              <option value="customer">Customers</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="brand_colour">Brand colour</label>
            <input id="brand_colour" name="brand_colour" type="color" defaultValue="#1f5f8b" className="h-10 w-14 cursor-pointer rounded border border-stone-300 bg-white p-1" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Link href={`/app/${slug}/settings`} className="btn-secondary">Cancel</Link>
          <button className="btn-primary">Create organisation</button>
        </div>
      </form>
    </div>
  );
}
