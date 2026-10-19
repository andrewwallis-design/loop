/**
 * Resend webhook: delivery, bounce and complaint events for invitation emails.
 * Signed with Svix headers; verified when RESEND_WEBHOOK_SECRET is set.
 */
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; message?: string };
    [key: string]: unknown;
  };
}

function parseEvent(raw: string): ResendEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") {
      return parsed as ResendEvent;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function POST(request: Request) {
  const raw = await request.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const headers = {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    };
    try {
      new Webhook(secret).verify(raw, headers);
    } catch {
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else {
    console.warn("[resend webhook] RESEND_WEBHOOK_SECRET not set; accepting unsigned event");
  }

  const event = parseEvent(raw);
  if (!event) return Response.json({ error: "Bad payload" }, { status: 400 });

  const admin = createAdminClient();
  const messageId = event.data?.email_id ?? null;
  const at = event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString();

  await admin.from("message_events").insert({
    provider: "resend",
    provider_message_id: messageId,
    event: event.type,
    payload: event as unknown as Record<string, unknown>,
  });

  if (!messageId) return Response.json({ ok: true, ignored: "no email_id" });

  switch (event.type) {
    case "email.delivered": {
      await admin
        .from("invitations")
        .update({ delivered_at: at, status: "delivered" })
        .eq("provider_message_id", messageId)
        .eq("status", "sent");
      await admin
        .from("invitations")
        .update({ delivered_at: at })
        .eq("provider_message_id", messageId)
        .is("delivered_at", null);
      await admin
        .from("broadcast_recipients")
        .update({ status: "delivered" })
        .eq("provider_message_id", messageId)
        .eq("status", "sent");
      break;
    }
    case "email.bounced":
    case "email.complained": {
      const reason =
        event.type === "email.complained"
          ? "Recipient marked the message as spam"
          : `Bounced${event.data?.bounce?.message ? `: ${event.data.bounce.message}` : ""}`;
      await admin
        .from("invitations")
        .update({ bounced_at: at, status: "bounced", error: reason })
        .eq("provider_message_id", messageId)
        .in("status", ["sent", "delivered", "opened"]);
      await admin
        .from("broadcast_recipients")
        .update({ status: "bounced", error: reason })
        .eq("provider_message_id", messageId);

      if (event.type === "email.complained") {
        const { data: inv } = await admin
          .from("invitations")
          .select("respondent_id")
          .eq("provider_message_id", messageId)
          .maybeSingle();
        const { data: br } = await admin
          .from("broadcast_recipients")
          .select("respondent_id")
          .eq("provider_message_id", messageId)
          .maybeSingle();
        const respondentId = (inv as { respondent_id: string } | null)?.respondent_id ?? (br as { respondent_id: string } | null)?.respondent_id;
        if (respondentId) {
          await admin
            .from("respondents")
            .update({ unsubscribed_at: at, consent_news: false })
            .eq("id", respondentId)
            .is("unsubscribed_at", null);
        }
      }
      break;
    }
    default:
      break;
  }

  return Response.json({ ok: true });
}
