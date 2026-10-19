"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadSurveyBundle, recordResponse, validateAnswers } from "@/lib/responses";
import type { SurveySubmission } from "@/components/survey-form";

export async function submitKioskResponse(
  slug: string,
  submission: SurveySubmission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organisations").select("kiosk_template_id").eq("slug", slug).maybeSingle();
  const bundle = org?.kiosk_template_id ? await loadSurveyBundle(org.kiosk_template_id) : null;
  if (!bundle) return { ok: false, error: "This survey is not available." };

  const problem = validateAnswers(bundle.questions, submission.answers);
  if (problem) return { ok: false, error: problem };

  try {
    await recordResponse({
      org: bundle.org,
      template: bundle.template,
      questions: bundle.questions,
      contactable: false, // kiosk responses have no respondent record; contact details would go in the comment
      contactRequested: false,
      source: "kiosk",
      answers: submission.answers,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}
