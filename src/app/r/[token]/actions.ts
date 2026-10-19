"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadSurveyBundle, recordResponse, validateAnswers } from "@/lib/responses";
import type { SurveySubmission } from "@/components/survey-form";

export async function submitInvitationResponse(
  token: string,
  submission: SurveySubmission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: invitation } = await admin
    .from("invitations")
    .select("id, status, template_id, respondent_id")
    .eq("token", token)
    .maybeSingle();
  if (!invitation || invitation.status === "cancelled") return { ok: false, error: "This link is no longer valid." };
  if (invitation.status === "answered") return { ok: false, error: "You have already answered this survey." };

  const bundle = await loadSurveyBundle(invitation.template_id);
  if (!bundle) return { ok: false, error: "This survey is no longer available." };

  const problem = validateAnswers(bundle.questions, submission.answers);
  if (problem) return { ok: false, error: problem };

  try {
    await recordResponse({
      org: bundle.org,
      template: bundle.template,
      questions: bundle.questions,
      invitationId: invitation.id,
      respondentId: invitation.respondent_id,
      contactable: submission.contactable,
      contactRequested: submission.contactRequested,
      source: "link",
      answers: submission.answers,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Please try again." };
  }
}
