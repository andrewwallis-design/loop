import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { Flash } from "@/components/flash";
import { createTemplate } from "../actions";
import { TemplateFormFields } from "../template-form";

export default async function NewTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { org: slug } = await params;
  await requireOrg(slug, "manager");
  const { error } = await searchParams;
  const action = createTemplate.bind(null, slug);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/templates`} className="text-sm text-stone-500 hover:underline">← Surveys</Link>
        <h1 className="mt-1 text-2xl font-semibold">New survey</h1>
        <p className="mt-1 text-sm text-stone-600">Keep it short: two minutes is about the limit for most people.</p>
      </div>
      <Flash error={error} />
      <form action={action} className="space-y-6">
        <TemplateFormFields
          questions={[
            { key: null, kind: "rating5", prompt: "Overall, how satisfied are you?", required: true, options: [] },
            { key: null, kind: "text", prompt: "Is there anything we should know, or anything we could do better?", required: false, options: [] },
          ]}
        />
        <div className="flex justify-end gap-2">
          <Link href={`/app/${slug}/templates`} className="btn-secondary">Cancel</Link>
          <button className="btn-primary">Create survey</button>
        </div>
      </form>
    </div>
  );
}
