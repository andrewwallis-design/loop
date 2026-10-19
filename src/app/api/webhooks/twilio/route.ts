/**
 * Twilio webhook for SMS and WhatsApp: delivery status callbacks and inbound
 * replies (including STOP). Responds with TwiML.
 */
import twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function stripChannel(number: string): string {
  return number.replace(/^whatsapp:/i, "").trim();
}

export async function POST(request: Request) {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token) {
    const signature = request.headers.get("x-twilio-signature") ?? "";
    const url = `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/api/webhooks/twilio`;
    if (!twilio.validateRequest(token, signature, url, params)) {
      return new Response("Invalid signature", { status: 403 });
    }
  } else {
    console.warn("[twilio webhook] TWILIO_AUTH_TOKEN not set; accepting unsigned request");
  }

  const admin = createAdminClient();
  const messageSid = params.MessageSid ?? params.SmsSid ?? null;
  const status = params.MessageStatus ?? params.SmsStatus ?? null;
  const body = params.Body;
  const from = params.From ? stripChannel(params.From) : null;
  const nowIso = new Date().toISOString();

  // Inbound message (a reply or STOP)
  if (body !== undefined && from) {
    const text = body.trim();
    const upper = text.toUpperCase();
    const isStop = ["STOP", "UNSUBSCRIBE", "STOPALL", "CANCEL", "END", "QUIT"].includes(upper);

    await admin.from("message_events").insert({
      provider: "twilio",
      provider_message_id: messageSid,
      event: isStop ? "inbound.stop" : "inbound.reply",
      payload: params,
    });

    if (isStop) {
      await admin
        .from("respondents")
        .update({ unsubscribed_at: nowIso, whatsapp_opt_in: false })
        .eq("mobile", from)
        .is("unsubscribed_at", null);
      return twiml("You've been unsubscribed and won't receive further messages from us.");
    }
    return twiml("Thank you for your message. The office will see it and get back to you if needed.");
  }

  // Status callback
  if (messageSid && status) {
    await admin.from("message_events").insert({
      provider: "twilio",
      provider_message_id: messageSid,
      event: `status.${status}`,
      payload: params,
    });

    if (status === "delivered" || status === "read") {
      await admin
        .from("invitations")
        .update({ delivered_at: nowIso, status: "delivered" })
        .eq("provider_message_id", messageSid)
        .eq("status", "sent");
      await admin
        .from("invitations")
        .update({ delivered_at: nowIso })
        .eq("provider_message_id", messageSid)
        .is("delivered_at", null);
      await admin
        .from("broadcast_recipients")
        .update({ status: "delivered" })
        .eq("provider_message_id", messageSid)
        .eq("status", "sent");
    } else if (status === "failed" || status === "undelivered") {
      const reason = `${status}${params.ErrorCode ? ` (Twilio error ${params.ErrorCode})` : ""}`;
      await admin
        .from("invitations")
        .update({ bounced_at: nowIso, status: "bounced", error: reason })
        .eq("provider_message_id", messageSid)
        .in("status", ["sent", "delivered", "opened"]);
      await admin
        .from("broadcast_recipients")
        .update({ status: "bounced", error: reason })
        .eq("provider_message_id", messageSid);
    }
  }

  return twiml();
}
