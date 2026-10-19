import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Template, TemplateQuestion } from "@/lib/types";
import { Flash } from "@/components/flash";
import { saveTemplateVersion } from "../../actions";
import { TemplateFormFields } from "../../template-form";

export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug, "manager");
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("templates").select("*").eq("id", id).eq("organisation_id", access.org.id).maybeSingle();
  if (!data) notFound();
  const template = data as Template;
  const { data: qs } = await supabase.from("template_questions").select("*").eq("template_id", id).order("position");
  const questions = ((qs ?? []) as TemplateQuestion[]).map((q) => ({
    key: q.key,
    kind: q.kind,
    prompt: q.prompt,
    required: q.required,
    options: q.options ?? [],
  }));

  const action = saveTemplateVersion.bind(null, slug, id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/app/${slug}/templates/${id}`} className="text-sm text-stone-500 hover:underline">← {template.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit survey</h1>
        <p className="mt-1 text-sm text-stone-600">
          Saving creates version {template.version + 1}. Questions you keep stay linked to their earlier answers; new ones start fresh.
          Campaigns using this survey switch to the new version automatically.
        </p>
      </div>
      <Flash error={error} />
      <form action={action} className="space-y-6">
        <TemplateFormFields template={template} questions={questions} />
        <div className="flex justify-end gap-2">
          <Link href={`/app/${slug}/templates/${id}`} className="btn-secondary">Cancel</Link>
          <button className="btn-primary">Save as version {template.version + 1}</button>
        </div>
      </form>
    </div>
  );
}
