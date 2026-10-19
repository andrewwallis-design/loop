import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SurveyForm } from "@/components/survey-form";
import { PublicShell } from "@/components/public-shell";
import type { Template, TemplateQuestion } from "@/lib/types";
import { previewSubmit } from "../../actions";

export default async function TemplatePreviewPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const access = await requireOrg(slug, "viewer");
  const supabase = await createClient();

  const { data } = await supabase.from("templates").select("*").eq("id", id).eq("organisation_id", access.org.id).maybeSingle();
  if (!data) notFound();
  const template = data as Template;
  const { data: qs } = await supabase.from("template_questions").select("*").eq("template_id", id).order("position");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/app/${slug}/templates/${id}`} className="text-sm text-stone-500 hover:underline">← {template.name}</Link>
          <h1 className="text-2xl font-semibold">Preview</h1>
          <p className="text-sm text-stone-600">This is what people see. Nothing you enter here is saved.</p>
        </div>
      </div>
      <div className="card p-0">
        <PublicShell title={access.org.name} logoUrl={access.org.logo_url} brandColour={access.org.brand_colour}>
          <SurveyForm
            orgName={access.org.short_name ?? access.org.name}
            brandColour={access.org.brand_colour}
            template={template}
            questions={(qs ?? []) as TemplateQuestion[]}
            onSubmit={previewSubmit}
          />
        </PublicShell>
      </div>
    </div>
  );
}
