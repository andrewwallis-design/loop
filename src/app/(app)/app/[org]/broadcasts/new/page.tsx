import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { Flash } from "@/components/flash";
import { BroadcastFields } from "../broadcast-fields";
import { createBroadcast } from "../actions";

export default async function NewBroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { org: slug } = await params;
  await requireOrg(slug, "manager");
  const { error } = await searchParams;
  const action = createBroadcast.bind(null, slug);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href={`/app/${slug}/broadcasts`} className="text-sm text-stone-500 hover:underline">← Broadcasts</Link>
        <h1 className="mt-1 text-2xl font-semibold">New broadcast</h1>
        <p className="mt-1 text-sm text-stone-600">Saved as a draft first. You will see how many people it reaches before anything is sent.</p>
      </div>
      <Flash error={error} />
      <form action={action} className="card space-y-5">
        <BroadcastFields />
        <div className="flex justify-end gap-2">
          <Link href={`/app/${slug}/broadcasts`} className="btn-secondary">Cancel</Link>
          <button className="btn-primary">Save draft</button>
        </div>
      </form>
    </div>
  );
}
