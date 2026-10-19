import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RESPONDENT_TYPE_LABEL, type Respondent, type Template, type TemplateQuestion } from "@/lib/types";
import { ManualEntry } from "./manual-entry";

export default async function NewResponsePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "staff");
  const supabase = await createClient();

  const { data: templatesData } = await supabase
    .from("templates")
    .select("*")
    .eq("organisation_id", access.org.id)
    .eq("is_current", true)
    .order("is_pulse")
    .order("name");
  const templates = (templatesData ?? []) as Template[];

  const [{ data: questionsData }, { data: people }] = await Promise.all([
    templates.length
      ? supabase.from("template_questions").select("*").in("template_id", templates.map((t) => t.id)).order("position")
      : Promise.resolve({ data: [] as TemplateQuestion[] }),
    supabase
      .from("respondents")
      .select("id, full_name, type, relationship_end")
      .eq("organisation_id", access.org.id)
      .is("relationship_end", null)
      .order("full_name")
      .limit(2000),
  ]);

  const respondents = ((people ?? []) as Pick<Respondent, "id" | "full_name" | "type">[]).map((p) => ({
    id: p.id,
    label: `${p.full_name} (${RESPONDENT_TYPE_LABEL[p.type]})`,
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href={`/app/${slug}/responses`} className="text-sm text-stone-500 hover:underline">← Responses</Link>
        <h1 className="mt-1 text-2xl font-semibold">Record a response by hand</h1>
        <p className="mt-1 text-sm text-stone-600">
          For feedback given over the phone, in person, or on a paper form. It is saved as entered by you.
        </p>
      </div>
      <ManualEntry
        slug={slug}
        orgName={access.org.short_name ?? access.org.name}
        brandColour={access.org.brand_colour}
        templates={templates}
        questions={(questionsData ?? []) as TemplateQuestion[]}
        respondents={respondents}
      />
    </div>
  );
}
