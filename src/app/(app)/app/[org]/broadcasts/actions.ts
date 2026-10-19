"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logAccess, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bool, str } from "@/lib/format";
import { RESPONDENT_TYPE_LABEL, type Channel, type RespondentType } from "@/lib/types";
import { sendBroadcast } from "@/lib/broadcasts";

const TYPES = Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[];
const CHANNELS: Channel[] = ["email", "whatsapp"];

interface BroadcastRow {
  subject: string;
  body: string;
  audience_types: RespondentType[];
  channels: Channel[];
  is_marketing: boolean;
  attachment_url: string | null;
}

function readBroadcastForm(form: FormData): { error: string; row?: undefined } | { error?: undefined; row: BroadcastRow } {
  const subject = str(form, "subject");
  const body = str(form, "body");
  if (!subject) return { error: "Give the message a subject." };
  if (!body) return { error: "Write the message." };
  const audience_types = form.getAll("audience_types").filter((v): v is RespondentType => TYPES.includes(v as RespondentType));
  const channels = form.getAll("channels").filter((v): v is Channel => CHANNELS.includes(v as Channel));
  if (audience_types.length === 0) return { error: "Choose at least one audience." };
  if (channels.length === 0) return { error: "Choose at least one channel." };
  const attachment = str(form, "attachment_url");
  if (attachment && !/^https?:\/\//i.test(attachment)) return { error: "The attachment link must start with https://." };
  return {
    row: {
      subject,
      body,
      audience_types,
      channels,
      is_marketing: bool(form, "is_marketing"),
      attachment_url: attachment,
    },
  };
}

export async function createBroadcast(slug: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const parsed = readBroadcastForm(form);
  if (parsed.error !== undefined) redirect(`/app/${slug}/broadcasts/new?error=${encodeURIComponent(parsed.error)}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({ ...parsed.row, organisation_id: access.org.id, created_by: access.session.userId, status: "draft" })
    .select("id")
    .single();
  if (error || !data) redirect(`/app/${slug}/broadcasts/new?error=${encodeURIComponent(error?.message ?? "Could not save")}`);
  revalidatePath(`/app/${slug}/broadcasts`);
  redirect(`/app/${slug}/broadcasts/${data.id}?ok=${encodeURIComponent("Draft saved. Check the recipient count, then send.")}`);
}

export async function updateBroadcast(slug: string, id: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const parsed = readBroadcastForm(form);
  if (parsed.error !== undefined) redirect(`/app/${slug}/broadcasts/${id}?error=${encodeURIComponent(parsed.error)}`);
  const supabase = await createClient();
  const { error } = await supabase
    .from("broadcasts")
    .update(parsed.row)
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .eq("status", "draft");
  if (error) redirect(`/app/${slug}/broadcasts/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/app/${slug}/broadcasts`);
  revalidatePath(`/app/${slug}/broadcasts/${id}`);
  redirect(`/app/${slug}/broadcasts/${id}?ok=${encodeURIComponent("Draft updated.")}`);
}

export async function deleteBroadcast(slug: string, id: string): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const supabase = await createClient();
  const { error } = await supabase
    .from("broadcasts")
    .delete()
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .eq("status", "draft");
  if (error) redirect(`/app/${slug}/broadcasts/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/app/${slug}/broadcasts`);
  redirect(`/app/${slug}/broadcasts?ok=${encodeURIComponent("Draft deleted.")}`);
}

export async function sendBroadcastAction(slug: string, id: string): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("broadcasts")
    .select("id, status")
    .eq("id", id)
    .eq("organisation_id", access.org.id)
    .maybeSingle();
  if (!b) redirect(`/app/${slug}/broadcasts?error=${encodeURIComponent("That broadcast was not found.")}`);
  if (b.status !== "draft") redirect(`/app/${slug}/broadcasts/${id}?error=${encodeURIComponent("This broadcast has already been sent.")}`);

  let result: { sent: number; skipped: number; failed: number };
  try {
    result = await sendBroadcast(id);
  } catch (e) {
    redirect(`/app/${slug}/broadcasts/${id}?error=${encodeURIComponent(e instanceof Error ? e.message : "Sending failed.")}`);
  }
  await logAccess(access, "send_broadcast", "broadcast", id, result);
  revalidatePath(`/app/${slug}/broadcasts`);
  revalidatePath(`/app/${slug}/broadcasts/${id}`);
  redirect(
    `/app/${slug}/broadcasts/${id}?ok=${encodeURIComponent(
      `Sent to ${result.sent}. ${result.skipped} skipped, ${result.failed} failed.`,
    )}`,
  );
}
