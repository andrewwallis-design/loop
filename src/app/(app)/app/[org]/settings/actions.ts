"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAccess, requireOrg } from "@/lib/auth";
import { int, str } from "@/lib/format";
import { toE164 } from "@/lib/phone";

function isTime(v: string | null) {
  return !!v && /^\d{2}:\d{2}$/.test(v);
}

function isEmail(v: string | null) {
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function updateOrganisation(slug: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const back = `/app/${slug}/settings`;
  const fail = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const name = str(form, "name");
  if (!name) fail("The organisation needs a name.");
  const from_email = str(form, "from_email");
  const reply_to = str(form, "reply_to");
  if (!isEmail(from_email)) fail("The from address does not look like an email address.");
  if (!isEmail(reply_to)) fail("The reply-to address does not look like an email address.");

  const whatsappRaw = str(form, "whatsapp_number");
  const smsRaw = str(form, "sms_number");
  const whatsapp_number = whatsappRaw ? toE164(whatsappRaw) : null;
  const sms_number = smsRaw ? toE164(smsRaw) : null;
  if (whatsappRaw && !whatsapp_number) fail("The WhatsApp number could not be read. Use +44… format.");
  if (smsRaw && !sms_number) fail("The SMS number could not be read. Use +44… format.");

  const brand_colour = str(form, "brand_colour") ?? "#1f5f8b";
  if (!/^#[0-9a-fA-F]{6}$/.test(brand_colour)) fail("Brand colour must be a hex colour such as #1f5f8b.");

  const quiet_hours_start = str(form, "quiet_hours_start");
  const quiet_hours_end = str(form, "quiet_hours_end");
  if (!isTime(quiet_hours_start) || !isTime(quiet_hours_end)) fail("Quiet hours need a start and end time.");

  const retention_responses_months = int(form, "retention_responses_months");
  const retention_contacts_months = int(form, "retention_contacts_months");
  const retention_broadcast_log_months = int(form, "retention_broadcast_log_months");
  for (const v of [retention_responses_months, retention_contacts_months, retention_broadcast_log_months]) {
    if (v === null || v < 1 || v > 240) fail("Retention periods must be whole months between 1 and 240.");
  }

  const logo_url = str(form, "logo_url");
  if (logo_url && !/^https?:\/\//.test(logo_url)) fail("The logo must be a full https:// address.");

  const supabase = await createClient();

  const kiosk_template_id = str(form, "kiosk_template_id");
  if (kiosk_template_id) {
    const { data: tpl } = await supabase.from("templates").select("id").eq("id", kiosk_template_id).eq("organisation_id", access.org.id).maybeSingle();
    if (!tpl) fail("That kiosk survey does not belong to this organisation.");
  }
  const concern_owner_user_id = str(form, "concern_owner_user_id");
  const concern_deputy_user_id = str(form, "concern_deputy_user_id");
  const memberIds = new Set<string>();
  if (concern_owner_user_id || concern_deputy_user_id) {
    const { data: members } = await supabase.from("memberships").select("user_id").eq("organisation_id", access.org.id);
    for (const m of members ?? []) memberIds.add(m.user_id);
    // The app owner may not have a membership row but is a valid owner of concerns
    memberIds.add(access.session.userId);
  }
  if (concern_owner_user_id && !memberIds.has(concern_owner_user_id)) fail("The concern owner must be a member of this organisation.");
  if (concern_deputy_user_id && !memberIds.has(concern_deputy_user_id)) fail("The concern deputy must be a member of this organisation.");

  const { error } = await supabase
    .from("organisations")
    .update({
      name,
      short_name: str(form, "short_name"),
      respondent_noun: (str(form, "respondent_noun") ?? "client").toLowerCase(),
      from_name: str(form, "from_name"),
      from_email,
      reply_to,
      whatsapp_number,
      sms_number,
      brand_colour: brand_colour.toLowerCase(),
      quiet_hours_start,
      quiet_hours_end,
      retention_responses_months,
      retention_contacts_months,
      retention_broadcast_log_months,
      kiosk_template_id: kiosk_template_id || null,
      concern_owner_user_id: concern_owner_user_id || null,
      concern_deputy_user_id: concern_deputy_user_id || null,
      logo_url,
    })
    .eq("id", access.org.id);
  if (error) fail(error.message);

  await logAccess(access, "update_organisation", "organisation", access.org.id);
  revalidatePath(`/app/${slug}`, "layout");
  redirect(`${back}?ok=${encodeURIComponent("Settings saved.")}`);
}
