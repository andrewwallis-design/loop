/**
 * Broadcasts: one-off information out to an audience (newsletters, notices).
 * Server-only; uses the service-role client.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, sendWhatsApp, sendSms, merge, appUrl } from "@/lib/send";
import type { SendResult } from "@/lib/send";
import { escapeHtml } from "@/lib/responses";
import { emailShell, textToHtml, firstName, orgDisplayName } from "@/lib/email";
import type { Broadcast, Channel, Organisation, Respondent } from "@/lib/types";

/** Which broadcast channel can this person receive, in the broadcast's order of preference? */
function chooseBroadcastChannel(channels: Channel[], r: Respondent): Channel | null {
  for (const ch of channels) {
    if (ch === "email" && r.email) return ch;
    if (ch === "whatsapp" && r.mobile && r.whatsapp_opt_in) return ch;
    if (ch === "sms" && r.mobile) return ch;
  }
  return null;
}

export function buildBroadcastEmail(
  org: Organisation,
  broadcast: Broadcast,
  respondent: Respondent,
): { subject: string; html: string; text: string } {
  const name = firstName(respondent.full_name);
  const orgName = orgDisplayName(org);
  const unsubscribe = appUrl(`/u/b/${respondent.id}`);
  const vars = { name, org: orgName, link: "" };
  const subject = merge(broadcast.subject, vars);
  const bodyText = merge(broadcast.body, vars);

  let body = textToHtml(bodyText);
  if (broadcast.attachment_url) {
    body += `<p style="margin:8px 0 14px 0;font-size:15px"><a href="${escapeHtml(broadcast.attachment_url)}" style="color:#1f5f8b">Open the attachment</a></p>`;
  }
  const footer = `${escapeHtml(org.name)} sent this to you as one of our ${escapeHtml(org.respondent_noun)}s.
${org.reply_to ? ` Replies reach ${escapeHtml(org.reply_to)}.` : ""}<br>
If you would rather not receive these messages, <a href="${unsubscribe}" style="color:#777">unsubscribe here</a>.`;

  const html = emailShell(org, body, footer);
  const text = `${bodyText}\n\n${broadcast.attachment_url ? `Attachment: ${broadcast.attachment_url}\n\n` : ""}To stop receiving these messages: ${unsubscribe}\n`;
  return { subject, html, text };
}

async function deliverBroadcast(org: Organisation, broadcast: Broadcast, r: Respondent, channel: Channel): Promise<SendResult> {
  if (channel === "email") {
    if (!r.email) return { ok: false, error: "No email address" };
    const built = buildBroadcastEmail(org, broadcast, r);
    return sendEmail(org, { to: r.email, subject: built.subject, html: built.html, text: built.text });
  }
  if (!r.mobile) return { ok: false, error: "No mobile number" };
  const vars = { name: firstName(r.full_name), org: orgDisplayName(org), link: "" };
  const parts = [merge(broadcast.subject, vars), merge(broadcast.body, vars)];
  if (broadcast.attachment_url) parts.push(broadcast.attachment_url);
  const body = parts.join("\n\n");
  if (channel === "whatsapp") return sendWhatsApp(org, { to: r.mobile, body });
  if (channel === "sms") return sendSms(org, { to: r.mobile, body });
  return { ok: false, error: `Channel ${channel} is not supported for broadcasts` };
}

export async function sendBroadcast(broadcastId: string): Promise<{ sent: number; skipped: number; failed: number }> {
  const admin = createAdminClient();
  const { data: b, error } = await admin.from("broadcasts").select("*").eq("id", broadcastId).single();
  if (error || !b) throw new Error(`Broadcast ${broadcastId} not found`);
  const broadcast = b as Broadcast;
  if (broadcast.status === "sent") return { sent: 0, skipped: 0, failed: 0 };

  const { data: o } = await admin.from("organisations").select("*").eq("id", broadcast.organisation_id).single();
  if (!o) throw new Error(`Organisation ${broadcast.organisation_id} not found`);
  const org = o as Organisation;

  // Claim the broadcast so a double click cannot send it twice.
  const { data: claimed } = await admin
    .from("broadcasts")
    .update({ status: "sending" })
    .eq("id", broadcast.id)
    .in("status", ["draft", "sending"])
    .select("id");
  if (!claimed || claimed.length === 0) return { sent: 0, skipped: 0, failed: 0 };

  let query = admin
    .from("respondents")
    .select("*")
    .eq("organisation_id", org.id)
    .in("type", broadcast.audience_types)
    .is("unsubscribed_at", null)
    .is("relationship_end", null);
  if (broadcast.is_marketing) query = query.eq("consent_news", true);
  const { data: people } = await query;
  const audience = (people ?? []) as Respondent[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Queue rows first (idempotent), then send anyone still queued.
  const queued: Array<{ broadcast_id: string; respondent_id: string; channel: Channel; status: string }> = [];
  const channelFor = new Map<string, Channel>();
  for (const r of audience) {
    const channel = chooseBroadcastChannel(broadcast.channels, r);
    if (!channel) {
      skipped++;
      continue;
    }
    channelFor.set(r.id, channel);
    queued.push({ broadcast_id: broadcast.id, respondent_id: r.id, channel, status: "queued" });
  }
  for (let i = 0; i < queued.length; i += 500) {
    const { error: upsertError } = await admin
      .from("broadcast_recipients")
      .upsert(queued.slice(i, i + 500), { onConflict: "broadcast_id,respondent_id", ignoreDuplicates: true });
    if (upsertError) throw new Error(`Could not queue recipients: ${upsertError.message}`);
  }

  const { data: pendingRows } = await admin
    .from("broadcast_recipients")
    .select("id, respondent_id, channel")
    .eq("broadcast_id", broadcast.id)
    .eq("status", "queued");
  const pending = (pendingRows ?? []) as Array<{ id: string; respondent_id: string; channel: Channel }>;
  const byId = new Map(audience.map((r) => [r.id, r]));

  for (const row of pending) {
    const r = byId.get(row.respondent_id);
    if (!r) {
      await admin.from("broadcast_recipients").update({ status: "skipped", error: "No longer in audience" }).eq("id", row.id);
      skipped++;
      continue;
    }
    // Claim this recipient before sending.
    const { data: mine } = await admin
      .from("broadcast_recipients")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (!mine || mine.length === 0) continue;

    const channel = channelFor.get(r.id) ?? row.channel;
    const result = await deliverBroadcast(org, broadcast, r, channel);
    if (result.ok) {
      await admin
        .from("broadcast_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: result.providerMessageId ?? null, channel })
        .eq("id", row.id);
      sent++;
    } else {
      await admin
        .from("broadcast_recipients")
        .update({ status: "failed", error: result.error ?? "Send failed", channel })
        .eq("id", row.id);
      failed++;
    }
  }

  await admin
    .from("broadcasts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", broadcast.id);

  return { sent, skipped, failed };
}
