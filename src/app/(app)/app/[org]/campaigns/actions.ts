"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasRole, logAccess, requireOrg } from "@/lib/auth";
import { int, str } from "@/lib/format";
import { enqueueCampaign, processDueInvitations, sendTestInvitation } from "@/lib/scheduler";
import {
  RESPONDENT_TYPE_LABEL,
  type Campaign,
  type Channel,
  type RespondentType,
  type TriggerKind,
} from "@/lib/types";
import { DEFAULT_MESSAGE } from "./constants";

const TYPES = Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[];
const SENDABLE: Channel[] = ["whatsapp", "email", "sms"];
const TRIGGERS: TriggerKind[] = ["adhoc", "event_relative", "calendar"];

function isCron(v: string) {
  return /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(v.trim());
}

export async function createCampaign(slug: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "staff");
  const back = `/app/${slug}/campaigns/new`;
  const fail = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const name = str(form, "name");
  if (!name) fail("Give the campaign a name.");
  const template_id = str(form, "template_id");
  if (!template_id) fail("Choose a survey.");
  const triggerRaw = str(form, "trigger_kind");
  const trigger_kind: TriggerKind = TRIGGERS.includes(triggerRaw as TriggerKind) ? (triggerRaw as TriggerKind) : "adhoc";
  if (trigger_kind !== "adhoc" && !hasRole(access.role, "manager")) {
    fail("Only a manager can set up a scheduled campaign. Staff can create ad hoc sends.");
  }

  const audience_types = TYPES.filter((t) => form.getAll("audience_types").includes(t));
  if (audience_types.length === 0) fail("Choose at least one audience.");
  const channels = SENDABLE.filter((c) => form.getAll("channels").includes(c));
  if (channels.length === 0) fail("Choose at least one channel.");

  let event_field: Campaign["event_field"] = null;
  let offset_days: number | null = null;
  let schedule_cron: string | null = null;
  if (trigger_kind === "event_relative") {
    const ef = str(form, "event_field");
    if (ef !== "relationship_start" && ef !== "event_date") fail("Choose which date the campaign works from.");
    event_field = ef as Campaign["event_field"];
    offset_days = int(form, "offset_days");
    if (offset_days === null || offset_days < 0 || offset_days > 3650) fail("Days after the event must be a whole number between 0 and 3650.");
  } else if (trigger_kind === "calendar") {
    const preset = str(form, "schedule_preset");
    schedule_cron = preset && preset !== "custom" ? preset : str(form, "schedule_cron");
    if (!schedule_cron || !isCron(schedule_cron)) fail("Choose a schedule or enter a 5-field cron expression.");
  }

  const reminder_after_days = int(form, "reminder_after_days") ?? 5;
  const min_days_between_surveys = int(form, "min_days_between_surveys") ?? 30;
  const message = str(form, "message") ?? DEFAULT_MESSAGE;

  const supabase = await createClient();
  const { data: tpl } = await supabase.from("templates").select("id").eq("id", template_id).eq("organisation_id", access.org.id).maybeSingle();
  if (!tpl) fail("That survey does not belong to this organisation.");

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      organisation_id: access.org.id,
      template_id,
      name,
      trigger_kind,
      event_field,
      offset_days,
      schedule_cron,
      audience_types,
      channels,
      message,
      reminder_after_days: Math.max(0, Math.min(reminder_after_days, 60)),
      min_days_between_surveys: Math.max(0, Math.min(min_days_between_surveys, 730)),
      status: "draft",
      created_by: access.session.userId,
    })
    .select("id")
    .single();
  if (error || !data) fail(error?.message ?? "Could not save.");

  await logAccess(access, "create_campaign", "campaign", data!.id);
  revalidatePath(`/app/${slug}/campaigns`);
  redirect(`/app/${slug}/campaigns/${data!.id}?ok=${encodeURIComponent("Campaign created. Send yourself a test before activating it.")}`);
}

async function loadCampaign(orgId: string, campaignId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("campaigns").select("*").eq("id", campaignId).eq("organisation_id", orgId).maybeSingle();
  return (data as Campaign | null) ?? null;
}

export async function sendTest(slug: string, campaignId: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "staff");
  const back = `/app/${slug}/campaigns/${campaignId}`;
  const campaign = await loadCampaign(access.org.id, campaignId);
  if (!campaign) redirect(`/app/${slug}/campaigns?error=${encodeURIComponent("Campaign not found.")}`);
  const email = str(form, "email") ?? access.session.profile.email;
  const result = await sendTestInvitation(campaignId, email);
  if (!result.ok) redirect(`${back}?error=${encodeURIComponent(`Test not sent: ${result.error ?? "unknown error"}`)}`);
  await logAccess(access, "send_test", "campaign", campaignId, { to: email });
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(`Test sent to ${email}.`)}`);
}

async function setStatus(slug: string, campaignId: string, status: Campaign["status"]) {
  const access = await requireOrg(slug, "manager");
  const back = `/app/${slug}/campaigns/${campaignId}`;
  const campaign = await loadCampaign(access.org.id, campaignId);
  if (!campaign) redirect(`/app/${slug}/campaigns?error=${encodeURIComponent("Campaign not found.")}`);
  if (status === "active" && !campaign.test_sent_at) {
    redirect(`${back}?error=${encodeURIComponent("Send yourself a test first; a campaign can only be activated after a test has gone out.")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ status }).eq("id", campaignId).eq("organisation_id", access.org.id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, `campaign_${status}`, "campaign", campaignId);
  revalidatePath(`/app/${slug}/campaigns`);
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(status === "active" ? "Campaign is live." : status === "paused" ? "Campaign paused." : "Campaign updated.")}`);
}

export async function activateCampaign(slug: string, campaignId: string): Promise<void> {
  await setStatus(slug, campaignId, "active");
}

export async function pauseCampaign(slug: string, campaignId: string): Promise<void> {
  await setStatus(slug, campaignId, "paused");
}

/** Ad hoc: queue invitations for the chosen people and send what is due straight away. */
export async function sendNow(slug: string, campaignId: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "staff");
  const back = `/app/${slug}/campaigns/${campaignId}`;
  const campaign = await loadCampaign(access.org.id, campaignId);
  if (!campaign) redirect(`/app/${slug}/campaigns?error=${encodeURIComponent("Campaign not found.")}`);
  if (campaign.trigger_kind !== "adhoc") redirect(`${back}?error=${encodeURIComponent("Only ad hoc campaigns can be sent by hand.")}`);
  if (!campaign.test_sent_at) redirect(`${back}?error=${encodeURIComponent("Send yourself a test before sending to people.")}`);

  const respondentIds = form.getAll("respondent_ids").filter((v): v is string => typeof v === "string" && v.length > 0);
  if (respondentIds.length === 0) redirect(`${back}?error=${encodeURIComponent("Tick at least one person.")}`);

  const queued = await enqueueCampaign(campaignId, { respondentIds });
  const processed = await processDueInvitations({ limit: 50 });
  if (campaign.status === "draft") {
    const supabase = await createClient();
    await supabase.from("campaigns").update({ status: "active", last_run_at: new Date().toISOString() }).eq("id", campaignId);
  }
  await logAccess(access, "send_campaign", "campaign", campaignId, {
    requested: respondentIds.length,
    created: queued.created,
    skipped: queued.skipped.length,
    sent: processed.sent,
    failed: processed.failed,
  });
  revalidatePath(back);
  const summary = `${queued.created} queued, ${processed.sent} sent now${processed.failed ? `, ${processed.failed} failed` : ""}${queued.skipped.length ? `, ${queued.skipped.length} skipped (${summariseSkips(queued.skipped)})` : ""}.`;
  redirect(`${back}?ok=${encodeURIComponent(summary)}`);
}

function summariseSkips(skipped: Array<{ respondentId: string; reason: string }>) {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, n]) => `${n} ${reason}`).join("; ");
}
