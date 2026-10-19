"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAccess, requireOrg } from "@/lib/auth";
import { bool, slugify, str } from "@/lib/format";
import { RESPONDENT_TYPE_LABEL, type QuestionKind, type RespondentType, type Template } from "@/lib/types";
import type { SurveySubmission } from "@/components/survey-form";

const KINDS: QuestionKind[] = ["rating5", "nps", "yesno", "choice", "text"];
const TYPES = Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[];

/** Shape posted by the question editor (hidden JSON field). */
export interface EditorQuestion {
  key: string | null; // null for a new question: generated from the prompt
  kind: QuestionKind;
  prompt: string;
  required: boolean;
  options: string[];
}

interface ParsedTemplate {
  name: string;
  audience: RespondentType;
  is_pulse: boolean;
  intro: string | null;
  anonymity_choice: boolean;
  non_performance_statement: boolean;
  thank_you: string;
  questions: Array<{ key: string; kind: QuestionKind; prompt: string; required: boolean; options: string[] | null }>;
}

function parseTemplateForm(form: FormData): { ok: true; value: ParsedTemplate } | { ok: false; error: string } {
  const name = str(form, "name");
  if (!name) return { ok: false, error: "Give the survey a name." };
  const audienceRaw = str(form, "audience");
  const audience: RespondentType = TYPES.includes(audienceRaw as RespondentType) ? (audienceRaw as RespondentType) : "client";

  let raw: EditorQuestion[];
  try {
    raw = JSON.parse(str(form, "questions") ?? "[]") as EditorQuestion[];
  } catch {
    return { ok: false, error: "The questions could not be read. Please try again." };
  }
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one question." };
  if (raw.length > 40) return { ok: false, error: "Keep it to 40 questions or fewer." };

  const used = new Set<string>();
  const questions: ParsedTemplate["questions"] = [];
  for (const q of raw) {
    const prompt = (q.prompt ?? "").trim();
    if (!prompt) return { ok: false, error: "Every question needs some wording." };
    const kind: QuestionKind = KINDS.includes(q.kind) ? q.kind : "rating5";
    const options = kind === "choice" ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : null;
    if (kind === "choice" && (!options || options.length < 2)) {
      return { ok: false, error: `"${prompt}" needs at least two options.` };
    }
    let key = (q.key ?? "").trim() || slugify(prompt) || "q";
    // Keys must be unique within a template; suffix on collision
    let candidate = key;
    let n = 2;
    while (used.has(candidate)) candidate = `${key}-${n++}`;
    key = candidate;
    used.add(key);
    questions.push({ key, kind, prompt, required: !!q.required, options });
  }

  return {
    ok: true,
    value: {
      name,
      audience,
      is_pulse: bool(form, "is_pulse"),
      intro: str(form, "intro"),
      anonymity_choice: bool(form, "anonymity_choice"),
      non_performance_statement: bool(form, "non_performance_statement"),
      thank_you: str(form, "thank_you") ?? "Thank you. Your feedback has been received.",
      questions,
    },
  };
}

async function insertQuestions(templateId: string, questions: ParsedTemplate["questions"]) {
  const supabase = await createClient();
  const { error } = await supabase.from("template_questions").insert(
    questions.map((q, i) => ({
      template_id: templateId,
      position: i + 1,
      key: q.key,
      kind: q.kind,
      prompt: q.prompt,
      options: q.options,
      required: q.required,
    })),
  );
  return error;
}

/** Creates a brand-new survey (new lineage, version 1). */
export async function createTemplate(slug: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const parsed = parseTemplateForm(form);
  if (!parsed.ok) redirect(`/app/${slug}/templates/new?error=${encodeURIComponent(parsed.error)}`);
  const { questions, ...fields } = parsed.value;

  const supabase = await createClient();
  const { data: tpl, error } = await supabase
    .from("templates")
    .insert({ ...fields, organisation_id: access.org.id, version: 1, is_current: true })
    .select("id")
    .single();
  if (error || !tpl) redirect(`/app/${slug}/templates/new?error=${encodeURIComponent(error?.message ?? "Could not save.")}`);

  const qErr = await insertQuestions(tpl.id, questions);
  if (qErr) {
    await supabase.from("templates").delete().eq("id", tpl.id);
    redirect(`/app/${slug}/templates/new?error=${encodeURIComponent(qErr.message)}`);
  }

  await logAccess(access, "create_template", "template", tpl.id);
  revalidatePath(`/app/${slug}/templates`);
  redirect(`/app/${slug}/templates/${tpl.id}?ok=${encodeURIComponent("Survey created.")}`);
}

/**
 * Saves an edit as a NEW version: inserts a templates row with the same lineage and
 * version+1, copies the edited questions, then retires the old row (is_current=false).
 * Existing invitations and responses keep pointing at the old version.
 */
export async function saveTemplateVersion(slug: string, templateId: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const parsed = parseTemplateForm(form);
  const back = `/app/${slug}/templates/${templateId}/edit`;
  if (!parsed.ok) redirect(`${back}?error=${encodeURIComponent(parsed.error)}`);
  const { questions, ...fields } = parsed.value;

  const supabase = await createClient();
  const { data: oldRow } = await supabase
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!oldRow) redirect(`/app/${slug}/templates?error=${encodeURIComponent("That survey was not found.")}`);
  const old = oldRow as Template;

  // Highest version in the lineage, in case the old row is not itself current
  const { data: latest } = await supabase
    .from("templates")
    .select("version")
    .eq("lineage_id", old.lineage_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? old.version) + 1;

  const { data: tpl, error } = await supabase
    .from("templates")
    .insert({
      ...fields,
      organisation_id: access.org.id,
      lineage_id: old.lineage_id,
      version: nextVersion,
      is_current: true,
    })
    .select("id")
    .single();
  if (error || !tpl) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not save.")}`);

  const qErr = await insertQuestions(tpl.id, questions);
  if (qErr) {
    await supabase.from("templates").delete().eq("id", tpl.id);
    redirect(`${back}?error=${encodeURIComponent(qErr.message)}`);
  }

  await supabase
    .from("templates")
    .update({ is_current: false })
    .eq("lineage_id", old.lineage_id)
    .neq("id", tpl.id);

  // Follow-on references move to the new version
  await supabase.from("campaigns").update({ template_id: tpl.id }).eq("organisation_id", access.org.id).eq("template_id", old.id).in("status", ["draft", "active", "paused"]);
  if (access.org.kiosk_template_id === old.id) {
    await supabase.from("organisations").update({ kiosk_template_id: tpl.id }).eq("id", access.org.id);
  }

  await logAccess(access, "new_template_version", "template", tpl.id, { from: old.id, version: nextVersion });
  revalidatePath(`/app/${slug}/templates`);
  redirect(`/app/${slug}/templates/${tpl.id}?ok=${encodeURIComponent(`Saved as version ${nextVersion}.`)}`);
}

/** Preview submit: validates nothing, stores nothing. */
export async function previewSubmit(submission: SurveySubmission): Promise<{ ok: true }> {
  void submission;
  return { ok: true };
}
