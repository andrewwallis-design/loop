"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, logAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordResponse, validateAnswers } from "@/lib/responses";
import type { SurveySubmission } from "@/components/survey-form";
import type { Template, TemplateQuestion } from "@/lib/types";

export type ManualSource = "staff_entered" | "letter";

export async function recordManualResponse(
  slug: string,
  input: { templateId: string; respondentId: string | null; source: ManualSource },
  submission: SurveySubmission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireOrg(slug, "staff");
  const supabase = await createClient();

  const source: ManualSource = input.source === "letter" ? "letter" : "staff_entered";

  const { data: template } = await supabase
    .from("templates")
    .select("*")
    .eq("id", input.templateId)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!template) return { ok: false, error: "Choose a survey." };

  const { data: questionsData } = await supabase
    .from("template_questions")
    .select("*")
    .eq("template_id", template.id)
    .order("position");
  const questions = (questionsData ?? []) as TemplateQuestion[];

  let respondentId: string | null = null;
  if (input.respondentId) {
    const { data: person } = await supabase
      .from("respondents")
      .select("id")
      .eq("id", input.respondentId)
      .eq("organisation_id", access.org.id)
      .maybeSingle();
    if (!person) return { ok: false, error: "That person is not on this organisation's list." };
    respondentId = person.id;
  }

  const problem = validateAnswers(questions, submission.answers);
  if (problem) return { ok: false, error: problem };

  try {
    const { responseId } = await recordResponse({
      org: access.org,
      template: template as Template,
      questions,
      respondentId,
      contactable: !!respondentId,
      contactRequested: !!respondentId && submission.contactRequested,
      source,
      enteredBy: access.session.userId,
      answers: submission.answers,
    });
    await logAccess(access, "record_response", "response", responseId, { source, identified: !!respondentId });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the response." };
  }

  revalidatePath(`/app/${slug}/responses`);
  revalidatePath(`/app/${slug}`);
  return { ok: true };
}
