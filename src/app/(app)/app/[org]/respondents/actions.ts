"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAccess, requireOrg } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { bool, str } from "@/lib/format";
import { RESPONDENT_TYPE_LABEL, type RespondentType } from "@/lib/types";
import type { ImportResult, ImportRow } from "./import-fields";

const TYPES = Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[];

function asType(v: string | null): RespondentType {
  return TYPES.includes(v as RespondentType) ? (v as RespondentType) : "client";
}

function asDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

type RespondentFormResult = { error: string; row?: undefined } | { error?: undefined; row: Record<string, unknown> };

/** Shared validation for add/edit forms. Returns the row to write or an error. */
function readRespondentForm(form: FormData, full: boolean): RespondentFormResult {
  const full_name = str(form, "full_name");
  const emailRaw = str(form, "email");
  const mobileRaw = str(form, "mobile");
  if (!full_name) return { error: "A name is required." };
  if (!emailRaw && !mobileRaw) return { error: "Enter an email address or a mobile number." };
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address does not look right." };
  const mobile = mobileRaw ? toE164(mobileRaw) : null;
  if (mobileRaw && !mobile) return { error: "That mobile number could not be read. Use 07700 900123 or +447700900123." };
  const type = asType(str(form, "type"));
  const row: Record<string, unknown> = {
    full_name,
    email,
    mobile,
    type,
    relates_to: type === "next_of_kin" ? str(form, "relates_to") : null,
    event_date: asDate(str(form, "event_date")),
    relationship_start: asDate(str(form, "relationship_start")),
    consent_news: bool(form, "consent_news"),
    whatsapp_opt_in: mobile ? bool(form, "whatsapp_opt_in") : false,
  };
  if (full) {
    row.relationship_end = asDate(str(form, "relationship_end"));
    row.notes = str(form, "notes");
    row.external_ref = str(form, "external_ref");
    row.consent_feedback = bool(form, "consent_feedback");
  }
  return { row };
}

function uniqueViolation(message: string) {
  if (message.includes("respondents_org_email_idx")) return "Someone with that email address is already on the list.";
  if (message.includes("respondents_org_mobile_idx")) return "Someone with that mobile number is already on the list.";
  return message;
}

export async function createRespondent(slug: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "staff");
  const parsed = readRespondentForm(form, false);
  if (parsed.error !== undefined) redirect(`/app/${slug}/respondents?error=${encodeURIComponent(parsed.error)}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("respondents")
    .insert({ ...parsed.row, organisation_id: access.org.id })
    .select("id")
    .single();
  if (error || !data) redirect(`/app/${slug}/respondents?error=${encodeURIComponent(uniqueViolation(error?.message ?? "Could not save."))}`);

  await logAccess(access, "create_respondent", "respondent", data.id);
  revalidatePath(`/app/${slug}/respondents`);
  redirect(`/app/${slug}/respondents?ok=${encodeURIComponent(`${parsed.row.full_name} added.`)}`);
}

export async function updateRespondent(slug: string, id: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "staff");
  const parsed = readRespondentForm(form, true);
  if (parsed.error !== undefined) redirect(`/app/${slug}/respondents/${id}?error=${encodeURIComponent(parsed.error)}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("respondents")
    .update(parsed.row)
    .eq("id", id)
    .eq("organisation_id", access.org.id);
  if (error) redirect(`/app/${slug}/respondents/${id}?error=${encodeURIComponent(uniqueViolation(error.message))}`);

  await logAccess(access, "update_respondent", "respondent", id);
  revalidatePath(`/app/${slug}/respondents`);
  revalidatePath(`/app/${slug}/respondents/${id}`);
  redirect(`/app/${slug}/respondents/${id}?ok=${encodeURIComponent("Saved.")}`);
}

/** Sets relationship_end to today so no further invitations go out; the record is kept for retention. */
export async function markLeft(slug: string, id: string): Promise<void> {
  const access = await requireOrg(slug, "staff");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("respondents")
    .update({ relationship_end: today })
    .eq("id", id)
    .eq("organisation_id", access.org.id);
  if (error) redirect(`/app/${slug}/respondents/${id}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "mark_left", "respondent", id);
  revalidatePath(`/app/${slug}/respondents`);
  revalidatePath(`/app/${slug}/respondents/${id}`);
  redirect(`/app/${slug}/respondents/${id}?ok=${encodeURIComponent("Marked as left. They will not receive further invitations.")}`);
}

export async function deleteRespondent(slug: string, id: string): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const supabase = await createClient();
  const { error } = await supabase.from("respondents").delete().eq("id", id).eq("organisation_id", access.org.id);
  if (error) redirect(`/app/${slug}/respondents/${id}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "delete_respondent", "respondent", id);
  revalidatePath(`/app/${slug}/respondents`);
  redirect(`/app/${slug}/respondents?ok=${encodeURIComponent("Record deleted.")}`);
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------


const TYPE_ALIASES: Record<string, RespondentType> = {
  client: "client",
  "service user": "client",
  customer: "client",
  "next of kin": "next_of_kin",
  next_of_kin: "next_of_kin",
  nok: "next_of_kin",
  family: "next_of_kin",
  relative: "next_of_kin",
  carer: "carer",
  staff: "carer",
  employee: "carer",
  pilot: "pilot",
  patient: "patient",
  other: "other",
};

function parseType(v: string | null | undefined, fallback: RespondentType): RespondentType {
  if (!v) return fallback;
  return TYPE_ALIASES[v.trim().toLowerCase()] ?? fallback;
}

/** Accepts ISO (2026-10-19), UK (19/10/2026, 19-10-26) and returns ISO or null. */
function parseDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/**
 * Upserts imported people by (organisation, lower(email)) or mobile. Never creates
 * duplicates; existing people have their details refreshed where the file provides them.
 */
export async function importRespondents(
  slug: string,
  input: { rows: ImportRow[]; defaultType: RespondentType },
): Promise<ImportResult> {
  const access = await requireOrg(slug, "staff");
  const supabase = await createClient();
  const result: ImportResult = { created: 0, updated: 0, skipped: [] };
  if (input.rows.length === 0) return result;
  if (input.rows.length > 2000) {
    result.skipped.push({ row: 0, name: "", reason: "Import at most 2,000 rows at a time." });
    return result;
  }

  const { data: existingRows } = await supabase
    .from("respondents")
    .select("id, email, mobile")
    .eq("organisation_id", access.org.id);
  const byEmail = new Map<string, string>();
  const byMobile = new Map<string, string>();
  for (const r of existingRows ?? []) {
    if (r.email) byEmail.set(r.email.toLowerCase(), r.id);
    if (r.mobile) byMobile.set(r.mobile, r.id);
  }

  const defaultType = parseType(input.defaultType, "client");

  for (let i = 0; i < input.rows.length; i++) {
    const raw = input.rows[i];
    const rowNo = i + 2; // header is row 1
    const full_name = raw.full_name?.trim() ?? "";
    const emailRaw = raw.email?.trim() ?? "";
    const mobileRaw = raw.mobile?.trim() ?? "";
    const label = full_name || emailRaw || mobileRaw || `row ${rowNo}`;

    if (!full_name) {
      result.skipped.push({ row: rowNo, name: label, reason: "No name" });
      continue;
    }
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.skipped.push({ row: rowNo, name: label, reason: `Email not valid: ${emailRaw}` });
      continue;
    }
    const mobile = mobileRaw ? toE164(mobileRaw) : null;
    if (mobileRaw && !mobile) {
      result.skipped.push({ row: rowNo, name: label, reason: `Mobile not valid: ${mobileRaw}` });
      continue;
    }
    if (!email && !mobile) {
      result.skipped.push({ row: rowNo, name: label, reason: "No email or mobile" });
      continue;
    }

    const emailMatch = email ? byEmail.get(email) : undefined;
    const mobileMatch = mobile ? byMobile.get(mobile) : undefined;
    if (emailMatch && mobileMatch && emailMatch !== mobileMatch) {
      result.skipped.push({ row: rowNo, name: label, reason: "Email and mobile belong to two different people already on the list" });
      continue;
    }
    const existingId = emailMatch ?? mobileMatch;

    const type = parseType(raw.type, defaultType);
    const patch: Record<string, unknown> = { full_name, type };
    if (email) patch.email = email;
    if (mobile) patch.mobile = mobile;
    if (raw.relates_to?.trim()) patch.relates_to = raw.relates_to.trim();
    if (raw.external_ref?.trim()) patch.external_ref = raw.external_ref.trim();
    const start = parseDate(raw.relationship_start);
    if (start) patch.relationship_start = start;
    const event = parseDate(raw.event_date);
    if (event) patch.event_date = event;

    if (existingId) {
      const { error } = await supabase
        .from("respondents")
        .update(patch)
        .eq("id", existingId)
        .eq("organisation_id", access.org.id);
      if (error) {
        result.skipped.push({ row: rowNo, name: label, reason: uniqueViolation(error.message) });
        continue;
      }
      result.updated++;
    } else {
      const { data, error } = await supabase
        .from("respondents")
        .insert({ ...patch, organisation_id: access.org.id })
        .select("id")
        .single();
      if (error || !data) {
        result.skipped.push({ row: rowNo, name: label, reason: uniqueViolation(error?.message ?? "Could not save") });
        continue;
      }
      result.created++;
      if (email) byEmail.set(email, data.id);
      if (mobile) byMobile.set(mobile, data.id);
    }
    // Keep the in-memory index current so a later row in the same file matches this one
    if (existingId) {
      if (email) byEmail.set(email, existingId);
      if (mobile) byMobile.set(mobile, existingId);
    }
  }

  await logAccess(access, "import_respondents", "respondent", undefined, {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped.length,
  });
  revalidatePath(`/app/${slug}/respondents`);
  return result;
}
