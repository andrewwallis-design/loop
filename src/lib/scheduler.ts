/**
 * Loop scheduler: creates invitations for campaigns, sends them when due,
 * sends reminders, and runs retention. Server-only; uses the service-role client.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, sendWhatsApp, sendSms, merge, appUrl } from "@/lib/send";
import type { SendResult } from "@/lib/send";
import { escapeHtml } from "@/lib/responses";
import { emailShell, emailButton, textToHtml, firstName, orgDisplayName } from "@/lib/email";
import { addDays, cronDueBetween, inQuietHours, londonDateString, nextQuietHoursEnd } from "@/lib/time";
import type {
  Campaign,
  Channel,
  Invitation,
  Organisation,
  Respondent,
  Template,
  TemplateQuestion,
} from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

const SENDABLE_CHANNELS: Channel[] = ["email", "whatsapp", "sms"];
const PULSE_FULL_GAP_DAYS = 30;
const DAY_MS = 86_400_000;

/** Default invitation wording when a campaign has none. {{link}} is appended for SMS/WhatsApp. */
export const DEFAULT_INVITATION_MESSAGE =
  "Hello {{name}},\n\nWe would like to know how we are doing at {{org}}. Could you spare two minutes to tell us? Your answers help us do better.";

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

interface CampaignContext {
  campaign: Campaign;
  template: Template;
  org: Organisation;
  questions: TemplateQuestion[];
}

async function loadCampaignContext(admin: Admin, campaignId: string): Promise<CampaignContext> {
  const { data: campaign, error } = await admin.from("campaigns").select("*").eq("id", campaignId).single();
  if (error || !campaign) throw new Error(`Campaign ${campaignId} not found`);
  const c = campaign as Campaign;
  const [{ data: template }, { data: org }, { data: questions }] = await Promise.all([
    admin.from("templates").select("*").eq("id", c.template_id).single(),
    admin.from("organisations").select("*").eq("id", c.organisation_id).single(),
    admin.from("template_questions").select("*").eq("template_id", c.template_id).order("position"),
  ]);
  if (!template) throw new Error(`Template ${c.template_id} not found`);
  if (!org) throw new Error(`Organisation ${c.organisation_id} not found`);
  return {
    campaign: c,
    template: template as Template,
    org: org as Organisation,
    questions: (questions ?? []) as TemplateQuestion[],
  };
}

async function loadRespondentsByIds(admin: Admin, orgId: string, ids: string[]): Promise<Respondent[]> {
  const out: Respondent[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin
      .from("respondents")
      .select("*")
      .eq("organisation_id", orgId)
      .in("id", ids.slice(i, i + 500));
    out.push(...((data ?? []) as Respondent[]));
  }
  return out;
}

/** Which channel, in the campaign's order of preference, can this person receive? */
export function chooseChannel(channels: Channel[], r: Respondent): Channel | null {
  for (const ch of channels) {
    if (ch === "email" && r.email) return ch;
    if (ch === "whatsapp" && r.mobile && r.whatsapp_opt_in) return ch;
    if (ch === "sms" && r.mobile) return ch;
    if (ch === "post") return ch;
  }
  return null;
}

/** Reason this person must not be invited at all, or null if they may be. */
export function ineligibleReason(r: Respondent): string | null {
  if (r.relationship_end) return "relationship ended";
  if (r.unsubscribed_at) return "unsubscribed";
  if (!r.consent_feedback) return "no consent to feedback";
  if (!r.email && !r.mobile) return "no email or mobile";
  return null;
}

// ---------------------------------------------------------------------------
// enqueueCampaign
// ---------------------------------------------------------------------------

interface RecentInvitationRow {
  respondent_id: string;
  sent_at: string | null;
  scheduled_for: string;
  status: string;
  templates: { is_pulse: boolean } | { is_pulse: boolean }[] | null;
}

export async function enqueueCampaign(
  campaignId: string,
  opts?: { respondentIds?: string[]; now?: Date },
): Promise<{ created: number; skipped: Array<{ respondentId: string; reason: string }> }> {
  const admin = createAdminClient();
  const now = opts?.now ?? new Date();
  const { campaign, template, org } = await loadCampaignContext(admin, campaignId);
  const skipped: Array<{ respondentId: string; reason: string }> = [];

  // Candidates
  let candidates: Respondent[];
  if (opts?.respondentIds) {
    if (opts.respondentIds.length === 0) return { created: 0, skipped };
    candidates = await loadRespondentsByIds(admin, org.id, opts.respondentIds);
    const found = new Set(candidates.map((r) => r.id));
    for (const id of opts.respondentIds) {
      if (!found.has(id)) skipped.push({ respondentId: id, reason: "not found in this organisation" });
    }
  } else {
    const { data } = await admin
      .from("respondents")
      .select("*")
      .eq("organisation_id", org.id)
      .in("type", campaign.audience_types);
    candidates = (data ?? []) as Respondent[];
  }
  if (candidates.length === 0) return { created: 0, skipped };

  const candidateIds = candidates.map((r) => r.id);

  // Existing invitations for this campaign
  const existing = new Set<string>();
  for (let i = 0; i < candidateIds.length; i += 500) {
    const { data } = await admin
      .from("invitations")
      .select("respondent_id")
      .eq("campaign_id", campaign.id)
      .in("respondent_id", candidateIds.slice(i, i + 500));
    for (const row of (data ?? []) as Array<{ respondent_id: string }>) existing.add(row.respondent_id);
  }

  // Recent invitations (any campaign) for the frequency rules
  const lookbackDays = Math.max(campaign.min_days_between_surveys, PULSE_FULL_GAP_DAYS);
  const since = new Date(now.getTime() - lookbackDays * DAY_MS).toISOString();
  const recent: RecentInvitationRow[] = [];
  for (let i = 0; i < candidateIds.length; i += 500) {
    const { data } = await admin
      .from("invitations")
      .select("respondent_id, sent_at, scheduled_for, status, templates(is_pulse)")
      .eq("organisation_id", org.id)
      .in("respondent_id", candidateIds.slice(i, i + 500))
      .not("status", "in", "(cancelled,failed)")
      .gte("scheduled_for", since);
    recent.push(...((data ?? []) as unknown as RecentInvitationRow[]));
  }
  const lastFull = new Map<string, number>();
  const lastPulse = new Map<string, number>();
  for (const row of recent) {
    const t = new Date(row.sent_at ?? row.scheduled_for).getTime();
    const tpl = Array.isArray(row.templates) ? row.templates[0] : row.templates;
    const target = tpl?.is_pulse ? lastPulse : lastFull;
    const prev = target.get(row.respondent_id) ?? 0;
    if (t > prev) target.set(row.respondent_id, t);
  }

  const rows: Array<{
    organisation_id: string;
    campaign_id: string;
    respondent_id: string;
    template_id: string;
    channel: Channel;
    scheduled_for: string;
    status: "scheduled";
  }> = [];

  for (const r of candidates) {
    const reason = ineligibleReason(r);
    if (reason) {
      skipped.push({ respondentId: r.id, reason });
      continue;
    }
    if (existing.has(r.id)) {
      skipped.push({ respondentId: r.id, reason: "already invited for this campaign" });
      continue;
    }
    const full = lastFull.get(r.id);
    const pulse = lastPulse.get(r.id);
    if (!template.is_pulse) {
      if (full !== undefined && now.getTime() - full < campaign.min_days_between_surveys * DAY_MS) {
        skipped.push({ respondentId: r.id, reason: `surveyed within the last ${campaign.min_days_between_surveys} days` });
        continue;
      }
      if (pulse !== undefined && now.getTime() - pulse < PULSE_FULL_GAP_DAYS * DAY_MS) {
        skipped.push({ respondentId: r.id, reason: "pulse survey within the last 30 days" });
        continue;
      }
    } else if (full !== undefined && now.getTime() - full < PULSE_FULL_GAP_DAYS * DAY_MS) {
      skipped.push({ respondentId: r.id, reason: "full survey within the last 30 days" });
      continue;
    }
    const channel = chooseChannel(campaign.channels, r);
    if (!channel) {
      skipped.push({ respondentId: r.id, reason: "no usable channel" });
      continue;
    }
    rows.push({
      organisation_id: org.id,
      campaign_id: campaign.id,
      respondent_id: r.id,
      template_id: template.id,
      channel,
      scheduled_for: now.toISOString(),
      status: "scheduled",
    });
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await admin
      .from("invitations")
      .upsert(chunk, { onConflict: "campaign_id,respondent_id", ignoreDuplicates: true })
      .select("id, respondent_id");
    if (error) throw new Error(`Could not create invitations: ${error.message}`);
    const inserted = (data ?? []) as Array<{ id: string; respondent_id: string }>;
    created += inserted.length;
    if (inserted.length < chunk.length) {
      const got = new Set(inserted.map((x) => x.respondent_id));
      for (const row of chunk) {
        if (!got.has(row.respondent_id)) skipped.push({ respondentId: row.respondent_id, reason: "already invited for this campaign" });
      }
    }
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// runScheduledCampaigns
// ---------------------------------------------------------------------------

export async function runScheduledCampaigns(now?: Date): Promise<{ campaigns: number; created: number }> {
  const admin = createAdminClient();
  const at = now ?? new Date();
  const { data } = await admin
    .from("campaigns")
    .select("*")
    .eq("status", "active")
    .in("trigger_kind", ["event_relative", "calendar"]);
  const campaigns = (data ?? []) as Campaign[];

  let ran = 0;
  let created = 0;
  for (const c of campaigns) {
    try {
      if (c.trigger_kind === "event_relative") {
        if (!c.event_field || c.offset_days === null) continue;
        const cutoff = addDays(londonDateString(at), -c.offset_days);
        const { data: people } = await admin
          .from("respondents")
          .select("id")
          .eq("organisation_id", c.organisation_id)
          .in("type", c.audience_types)
          .is("relationship_end", null)
          .is("unsubscribed_at", null)
          .eq("consent_feedback", true)
          .not(c.event_field, "is", null)
          .lte(c.event_field, cutoff);
        const ids = ((people ?? []) as Array<{ id: string }>).map((p) => p.id);
        if (ids.length === 0) {
          await admin.from("campaigns").update({ last_run_at: at.toISOString() }).eq("id", c.id);
          continue;
        }
        const invited = new Set<string>();
        for (let i = 0; i < ids.length; i += 500) {
          const { data: inv } = await admin
            .from("invitations")
            .select("respondent_id")
            .eq("campaign_id", c.id)
            .in("respondent_id", ids.slice(i, i + 500));
          for (const row of (inv ?? []) as Array<{ respondent_id: string }>) invited.add(row.respondent_id);
        }
        const fresh = ids.filter((id) => !invited.has(id));
        if (fresh.length > 0) {
          const result = await enqueueCampaign(c.id, { respondentIds: fresh, now: at });
          created += result.created;
          ran++;
        }
        await admin.from("campaigns").update({ last_run_at: at.toISOString() }).eq("id", c.id);
      } else if (c.trigger_kind === "calendar") {
        if (!c.schedule_cron) continue;
        const since = c.last_run_at ? new Date(c.last_run_at) : new Date(at.getTime() - DAY_MS);
        if (!cronDueBetween(c.schedule_cron, since, at)) continue;
        // Claim the run before enqueueing so two overlapping ticks cannot both fire it.
        const { data: claimed } = await admin
          .from("campaigns")
          .update({ last_run_at: at.toISOString() })
          .eq("id", c.id)
          .eq("status", "active")
          .filter("last_run_at", c.last_run_at ? "eq" : "is", c.last_run_at ?? null)
          .select("id");
        if (!claimed || claimed.length === 0) continue;
        const result = await enqueueCampaign(c.id, { now: at });
        created += result.created;
        ran++;
      }
    } catch (e) {
      console.error(`[scheduler] campaign ${c.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { campaigns: ran, created };
}

// ---------------------------------------------------------------------------
// Message building
// ---------------------------------------------------------------------------

export interface InvitationEmailInput {
  org: Organisation;
  template: Template;
  firstQuestion: TemplateQuestion | null | undefined;
  name: string;
  message: string;
  link: string;
}

/** One-tap answer row for a rating5 or NPS first question. */
function oneTapRow(q: TemplateQuestion, link: string, colour: string): string {
  const sep = link.includes("?") ? "&" : "?";
  const values =
    q.kind === "rating5"
      ? [1, 2, 3, 4, 5]
      : q.kind === "nps"
        ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        : [];
  if (values.length === 0) return "";
  const size = q.kind === "rating5" ? 48 : 34;
  const font = q.kind === "rating5" ? 18 : 14;
  const cells = values
    .map(
      (v) =>
        `<td align="center" style="padding:3px"><a href="${link}${sep}a=${v}" style="display:block;width:${size}px;height:${size}px;line-height:${size}px;border:2px solid ${colour};border-radius:8px;color:${colour};font-size:${font}px;font-weight:600;text-decoration:none">${v}</a></td>`,
    )
    .join("");
  const low = q.kind === "rating5" ? "Poor" : "Not at all likely";
  const high = q.kind === "rating5" ? "Excellent" : "Extremely likely";
  return `<p style="margin:18px 0 8px 0;font-size:16px;font-weight:600;color:#222">${escapeHtml(q.prompt)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>${cells}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:12px;color:#777;padding:4px 6px" align="left">${low}</td>
<td style="font-size:12px;color:#777;padding:4px 6px" align="right">${high}</td>
</tr></table>
<p style="margin:6px 0 0 0;font-size:13px;color:#777;text-align:center">Tap a number to answer, then add anything else on the next page.</p>`;
}

/** Builds the invitation email so the live send and the test send look identical. */
export function buildInvitationEmail(input: InvitationEmailInput): { subject: string; html: string; text: string } {
  const { org, template, firstQuestion, name, message, link } = input;
  const orgName = orgDisplayName(org);
  const colour = org.brand_colour;
  const token = link.split("/r/")[1] ?? "";
  const unsubscribe = appUrl(`/u/${token.split("?")[0]}`);

  const subject =
    template.is_pulse && firstQuestion ? `${firstQuestion.prompt} — ${orgName}` : `How are we doing? — ${orgName}`;

  const greetingPresent = /^\s*(hello|hi|dear)\b/i.test(message);
  const greeting = greetingPresent ? "" : `<p style="margin:0 0 14px 0;font-size:16px;color:#222">Hello ${escapeHtml(name)},</p>`;
  const oneTap =
    firstQuestion && (firstQuestion.kind === "rating5" || firstQuestion.kind === "nps")
      ? oneTapRow(firstQuestion, link, /^#[0-9a-fA-F]{3,8}$/.test(colour) ? colour : "#1f5f8b")
      : "";

  const body = `${greeting}${textToHtml(message)}${oneTap}${emailButton(link, "Give feedback", colour)}
<p style="margin:0 0 8px 0;font-size:13px;color:#777;text-align:center">Or copy this link into your browser:<br><a href="${link}" style="color:#1f5f8b;word-break:break-all">${link}</a></p>`;

  const footer = `${org.reply_to ? `You can reply to this email and it will reach ${escapeHtml(org.reply_to)}.<br>` : ""}
${escapeHtml(org.name)} sent this because you receive, or recently received, a service from us.
If you would rather not get feedback requests, <a href="${unsubscribe}" style="color:#777">unsubscribe here</a>.`;

  const html = emailShell(org, body, footer);
  const text = `${greetingPresent ? "" : `Hello ${name},\n\n`}${message}\n\nGive feedback: ${link}\n\n${
    org.reply_to ? `Replies reach ${org.reply_to}.\n` : ""
  }To stop receiving feedback requests: ${unsubscribe}\n`;

  return { subject, html, text };
}

interface MessageParts {
  name: string;
  orgName: string;
  link: string;
  text: string; // merged message body (link appended if absent)
}

function buildMessageParts(campaign: Campaign, org: Organisation, respondent: Respondent, token: string, prefix = ""): MessageParts {
  const name = firstName(respondent.full_name);
  const orgName = orgDisplayName(org);
  const link = appUrl(`/r/${token}`);
  const raw = campaign.message?.trim() ? campaign.message : DEFAULT_INVITATION_MESSAGE;
  let text = merge(raw, { name, org: orgName, link });
  if (!raw.includes("{{link}}") && !raw.includes("{{ link }}")) text = `${text}\n\n${link}`;
  return { name, orgName, link, text: prefix ? `${prefix}${text}` : text };
}

async function deliver(
  org: Organisation,
  ctx: CampaignContext,
  respondent: Respondent,
  invitation: Invitation,
  reminder: boolean,
): Promise<SendResult> {
  const prefix = reminder ? "A gentle reminder: " : "";
  const parts = buildMessageParts(ctx.campaign, org, respondent, invitation.token, prefix);
  switch (invitation.channel) {
    case "email": {
      if (!respondent.email) return { ok: false, error: "No email address" };
      const raw = ctx.campaign.message?.trim() ? ctx.campaign.message : DEFAULT_INVITATION_MESSAGE;
      const merged = merge(raw, { name: parts.name, org: parts.orgName, link: parts.link });
      const emailMessage = reminder ? `A gentle reminder: we would still love to hear from you.\n\n${merged}` : merged;
      const built = buildInvitationEmail({
        org,
        template: ctx.template,
        firstQuestion: ctx.questions[0] ?? null,
        name: parts.name,
        message: emailMessage,
        link: parts.link,
      });
      return sendEmail(org, {
        to: respondent.email,
        subject: reminder ? `Reminder: ${built.subject}` : built.subject,
        html: built.html,
        text: built.text,
      });
    }
    case "whatsapp": {
      if (!respondent.mobile) return { ok: false, error: "No mobile number" };
      const contentSid = process.env.WHATSAPP_INVITE_CONTENT_SID;
      return sendWhatsApp(org, {
        to: respondent.mobile,
        body: parts.text,
        ...(contentSid
          ? { contentSid, contentVariables: { "1": parts.name, "2": parts.orgName, "3": parts.link } }
          : {}),
      });
    }
    case "sms": {
      if (!respondent.mobile) return { ok: false, error: "No mobile number" };
      return sendSms(org, { to: respondent.mobile, body: parts.text });
    }
    default:
      return { ok: false, error: `Channel ${invitation.channel} is not sent automatically` };
  }
}

// ---------------------------------------------------------------------------
// Context caches shared by the send loops
// ---------------------------------------------------------------------------

class ContextCache {
  private campaigns = new Map<string, Promise<CampaignContext>>();
  private respondents = new Map<string, Promise<Respondent | null>>();
  constructor(private admin: Admin) {}

  campaign(id: string): Promise<CampaignContext> {
    let p = this.campaigns.get(id);
    if (!p) {
      p = loadCampaignContext(this.admin, id);
      this.campaigns.set(id, p);
    }
    return p;
  }

  respondent(id: string): Promise<Respondent | null> {
    let p = this.respondents.get(id);
    if (!p) {
      const load = async (): Promise<Respondent | null> => {
        const { data } = await this.admin.from("respondents").select("*").eq("id", id).maybeSingle();
        return (data as Respondent | null) ?? null;
      };
      p = load();
      this.respondents.set(id, p);
    }
    return p;
  }
}

// ---------------------------------------------------------------------------
// processDueInvitations
// ---------------------------------------------------------------------------

export async function processDueInvitations(opts?: { limit?: number; now?: Date }): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 100;
  const cache = new ContextCache(admin);

  const { data } = await admin
    .from("invitations")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .in("channel", SENDABLE_CHANNELS)
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  const due = (data ?? []) as Invitation[];

  let sent = 0;
  let failed = 0;

  for (const inv of due) {
    try {
      const ctx = await cache.campaign(inv.campaign_id);
      const org = ctx.org;

      // Quiet hours apply to SMS and WhatsApp only: push the send to the end of the window.
      if ((inv.channel === "sms" || inv.channel === "whatsapp") && inQuietHours(now, org.quiet_hours_start, org.quiet_hours_end)) {
        const next = nextQuietHoursEnd(now, org.quiet_hours_end);
        await admin
          .from("invitations")
          .update({ scheduled_for: next.toISOString() })
          .eq("id", inv.id)
          .eq("status", "scheduled");
        continue;
      }

      const respondent = await cache.respondent(inv.respondent_id);
      const ineligible = respondent ? ineligibleReason(respondent) : "respondent no longer exists";
      if (!respondent || ineligible) {
        await admin
          .from("invitations")
          .update({ status: "cancelled", error: ineligible })
          .eq("id", inv.id)
          .eq("status", "scheduled");
        continue;
      }

      // Claim: only the run that flips scheduled -> sent may send.
      const { data: claimed } = await admin
        .from("invitations")
        .update({ status: "sent", sent_at: now.toISOString() })
        .eq("id", inv.id)
        .eq("status", "scheduled")
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      const result = await deliver(org, ctx, respondent, inv, false);
      if (result.ok) {
        await admin
          .from("invitations")
          .update({ provider_message_id: result.providerMessageId ?? null, error: null })
          .eq("id", inv.id);
        sent++;
      } else {
        await admin
          .from("invitations")
          .update({ status: "failed", error: result.error ?? "Send failed" })
          .eq("id", inv.id);
        failed++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[scheduler] invitation ${inv.id} failed:`, message);
      await admin.from("invitations").update({ status: "failed", error: message }).eq("id", inv.id).in("status", ["scheduled", "sent"]);
      failed++;
    }
  }

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// sendReminders
// ---------------------------------------------------------------------------

interface ReminderRow extends Invitation {
  campaigns: { reminder_after_days: number; status: string } | { reminder_after_days: number; status: string }[] | null;
}

export async function sendReminders(now?: Date): Promise<{ sent: number }> {
  const admin = createAdminClient();
  const at = now ?? new Date();
  const cache = new ContextCache(admin);

  // Anything sent in the last day cannot be due yet (reminder_after_days >= 1).
  const { data } = await admin
    .from("invitations")
    .select("*, campaigns(reminder_after_days, status)")
    .in("status", ["sent", "delivered", "opened"])
    .in("channel", SENDABLE_CHANNELS)
    .is("reminder_sent_at", null)
    .is("answered_at", null)
    .is("bounced_at", null)
    .not("sent_at", "is", null)
    .lte("sent_at", new Date(at.getTime() - DAY_MS).toISOString())
    .order("sent_at", { ascending: true })
    .limit(200);
  const rows = (data ?? []) as unknown as ReminderRow[];

  let sent = 0;
  for (const row of rows) {
    const campaignMeta = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
    if (!campaignMeta || !row.sent_at) continue;
    const afterDays = campaignMeta.reminder_after_days;
    if (afterDays <= 0) continue; // reminders disabled for this campaign
    if (campaignMeta.status !== "active" && campaignMeta.status !== "done") continue; // paused/draft: hold
    if (at.getTime() - new Date(row.sent_at).getTime() < afterDays * DAY_MS) continue;

    try {
      const ctx = await cache.campaign(row.campaign_id);
      const org = ctx.org;
      if ((row.channel === "sms" || row.channel === "whatsapp") && inQuietHours(at, org.quiet_hours_start, org.quiet_hours_end)) {
        continue; // try again on a later tick
      }
      const respondent = await cache.respondent(row.respondent_id);
      if (!respondent || ineligibleReason(respondent)) {
        await admin.from("invitations").update({ reminder_sent_at: at.toISOString() }).eq("id", row.id);
        continue;
      }

      // Claim the reminder so concurrent ticks cannot both send it.
      const { data: claimed } = await admin
        .from("invitations")
        .update({ reminder_sent_at: at.toISOString() })
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      const result = await deliver(org, ctx, respondent, row, true);
      if (result.ok) sent++;
      else await admin.from("invitations").update({ error: `Reminder failed: ${result.error ?? "unknown"}` }).eq("id", row.id);
    } catch (e) {
      console.error(`[scheduler] reminder ${row.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { sent };
}

// ---------------------------------------------------------------------------
// sendTestInvitation
// ---------------------------------------------------------------------------

export async function sendTestInvitation(campaignId: string, toEmail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = createAdminClient();
    const ctx = await loadCampaignContext(admin, campaignId);
    const name = "Sam";
    const orgName = orgDisplayName(ctx.org);
    const link = appUrl("/r/test");
    const raw = ctx.campaign.message?.trim() ? ctx.campaign.message : DEFAULT_INVITATION_MESSAGE;
    const message = merge(raw, { name, org: orgName, link });
    const built = buildInvitationEmail({
      org: ctx.org,
      template: ctx.template,
      firstQuestion: ctx.questions[0] ?? null,
      name,
      message,
      link,
    });
    const result = await sendEmail(ctx.org, {
      to: toEmail,
      subject: `[TEST] ${built.subject}`,
      html: built.html,
      text: built.text,
    });
    if (!result.ok) return { ok: false, error: result.error ?? "Send failed" };
    await admin.from("campaigns").update({ test_sent_at: new Date().toISOString() }).eq("id", campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// runRetention
// ---------------------------------------------------------------------------

export async function runRetention(): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("run_retention");
  if (error) throw new Error(`run_retention failed: ${error.message}`);
}
