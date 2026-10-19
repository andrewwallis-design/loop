import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, appUrl } from "@/lib/send";
import type {
  AnswerValue,
  Organisation,
  Template,
  TemplateQuestion,
  ResponseSource,
} from "@/lib/types";

export interface SurveyBundle {
  org: Organisation;
  template: Template;
  questions: TemplateQuestion[];
}

/** Loads a template with its questions and organisation (service role; used by public pages). */
export async function loadSurveyBundle(templateId: string): Promise<SurveyBundle | null> {
  const admin = createAdminClient();
  const { data: template } = await admin.from("templates").select("*").eq("id", templateId).single();
  if (!template) return null;
  const [{ data: org }, { data: questions }] = await Promise.all([
    admin.from("organisations").select("*").eq("id", template.organisation_id).single(),
    admin.from("template_questions").select("*").eq("template_id", templateId).order("position"),
  ]);
  if (!org) return null;
  return { org: org as Organisation, template: template as Template, questions: (questions ?? []) as TemplateQuestion[] };
}

export interface RecordResponseInput {
  org: Organisation;
  template: Template;
  questions: TemplateQuestion[];
  invitationId?: string | null;
  respondentId?: string | null;
  contactable: boolean;
  contactRequested: boolean;
  source: ResponseSource;
  enteredBy?: string | null;
  answers: Record<string, AnswerValue>;
}

/** Validates answers against the template. Returns an error message or null. */
export function validateAnswers(questions: TemplateQuestion[], answers: Record<string, AnswerValue>): string | null {
  for (const q of questions) {
    const v = answers[q.key];
    const empty = v === null || v === undefined || v === "";
    if (q.required && empty) return `Please answer: ${q.prompt}`;
    if (empty) continue;
    switch (q.kind) {
      case "rating5":
        if (typeof v !== "number" || v < 1 || v > 5) return `Invalid rating for: ${q.prompt}`;
        break;
      case "nps":
        if (typeof v !== "number" || v < 0 || v > 10) return `Invalid score for: ${q.prompt}`;
        break;
      case "yesno":
        if (typeof v !== "boolean") return `Invalid answer for: ${q.prompt}`;
        break;
      case "choice":
        if (typeof v !== "string" || !(q.options ?? []).includes(v)) return `Invalid choice for: ${q.prompt}`;
        break;
      case "text":
        if (typeof v !== "string" || v.length > 4000) return `Comment too long for: ${q.prompt}`;
        break;
    }
  }
  return null;
}

/**
 * Stores a response, marks the invitation answered, and raises any immediate concern
 * flags (low rating, contact requested). AI classification runs later on the scheduler.
 */
export async function recordResponse(input: RecordResponseInput): Promise<{ responseId: string }> {
  const admin = createAdminClient();
  const freeText = input.questions
    .filter((q) => q.kind === "text")
    .map((q) => input.answers[q.key])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join("\n\n");

  const { data: response, error } = await admin
    .from("responses")
    .insert({
      organisation_id: input.org.id,
      template_id: input.template.id,
      invitation_id: input.invitationId ?? null,
      respondent_id: input.contactable ? (input.respondentId ?? null) : null,
      contactable: input.contactable,
      source: input.source,
      entered_by: input.enteredBy ?? null,
      answers: input.answers,
      free_text: freeText || null,
    })
    .select("id")
    .single();
  if (error || !response) throw new Error(error?.message ?? "Could not save response");

  if (input.invitationId) {
    await admin
      .from("invitations")
      .update({ status: "answered", answered_at: new Date().toISOString() })
      .eq("id", input.invitationId);
  }

  // Immediate concern flags
  const reasons: Array<{ reason: string; summary: string }> = [];
  for (const q of input.questions) {
    const v = input.answers[q.key];
    if (q.kind === "rating5" && typeof v === "number" && v <= 2) {
      reasons.push({ reason: "low_rating", summary: `Rated ${v}/5 for "${q.prompt}"` });
    }
    if (q.kind === "nps" && typeof v === "number" && v <= 3) {
      reasons.push({ reason: "low_rating", summary: `Scored ${v}/10 for "${q.prompt}"` });
    }
  }
  if (input.contactRequested) {
    reasons.push({ reason: "contact_requested", summary: "Respondent asked to be contacted about this" });
  }
  if (reasons.length > 0) {
    await raiseConcern(input.org, response.id, reasons[0].reason, reasons.map((r) => r.summary).join("; "));
  }
  return { responseId: response.id };
}

/** Creates (or extends) the concern for a response and alerts the organisation's owner and deputy. */
export async function raiseConcern(org: Organisation, responseId: string, reason: string, summary: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("concerns")
    .select("id, summary")
    .eq("response_id", responseId)
    .maybeSingle();

  if (existing) {
    await admin
      .from("concerns")
      .update({ summary: [existing.summary, summary].filter(Boolean).join("; ") })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: concern } = await admin
    .from("concerns")
    .insert({
      organisation_id: org.id,
      response_id: responseId,
      reason,
      summary,
      owner_user_id: org.concern_owner_user_id,
    })
    .select("id")
    .single();
  if (!concern) return null;

  // Alert owner and deputy by email
  const ids = [org.concern_owner_user_id, org.concern_deputy_user_id].filter((x): x is string => !!x);
  if (ids.length > 0) {
    const { data: people } = await admin.from("profiles").select("email, full_name").in("id", ids);
    const link = appUrl(`/app/${org.slug}/concerns/${concern.id}`);
    for (const p of people ?? []) {
      await sendEmail(org, {
        to: p.email,
        subject: `[Loop] Concern raised — ${org.short_name ?? org.name}`,
        text: `A feedback response has been flagged for ${org.name}.\n\n${summary}\n\nOpen it: ${link}\n\nThis needs a closure note once it has been dealt with.`,
        html: `<p>A feedback response has been flagged for <strong>${org.name}</strong>.</p><p>${escapeHtml(summary)}</p><p><a href="${link}">Open the concern</a></p><p style="color:#666;font-size:13px">This needs a closure note once it has been dealt with.</p>`,
      });
    }
    await admin.from("concerns").update({ alerted_at: new Date().toISOString() }).eq("id", concern.id);
  }
  return concern.id;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
