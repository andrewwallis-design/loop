import { Resend } from "resend";
import twilio from "twilio";
import type { Organisation } from "@/lib/types";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

const DEFAULT_FROM_DOMAIN = process.env.DEFAULT_FROM_DOMAIN; // optional fallback, e.g. feedback.example.co.uk

function fromAddress(org: Organisation) {
  const email = org.from_email ?? (DEFAULT_FROM_DOMAIN ? `feedback@${DEFAULT_FROM_DOMAIN}` : null);
  if (!email) throw new Error(`No from_email configured for ${org.name}`);
  return `${org.from_name ?? org.name} <${email}>`;
}

export async function sendEmail(
  org: Organisation,
  opts: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> },
): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not set" };
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(org),
      to: opts.to,
      replyTo: org.reply_to ?? undefined,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers: opts.headers,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, providerMessageId: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/**
 * WhatsApp via Twilio. Business-initiated messages must use a pre-approved
 * template; pass contentSid + variables for that. Free-form body is only
 * delivered inside a 24-hour customer-service window (e.g. a reply).
 */
export async function sendWhatsApp(
  org: Organisation,
  opts: { to: string; body: string; contentSid?: string; contentVariables?: Record<string, string> },
): Promise<SendResult> {
  const client = twilioClient();
  if (!client) return { ok: false, error: "Twilio not configured" };
  if (!org.whatsapp_number) return { ok: false, error: `No WhatsApp number for ${org.name}` };
  try {
    const msg = await client.messages.create({
      from: `whatsapp:${org.whatsapp_number}`,
      to: `whatsapp:${opts.to}`,
      ...(opts.contentSid
        ? { contentSid: opts.contentSid, contentVariables: JSON.stringify(opts.contentVariables ?? {}) }
        : { body: opts.body }),
      statusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`,
    });
    return { ok: true, providerMessageId: msg.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendSms(org: Organisation, opts: { to: string; body: string }): Promise<SendResult> {
  const client = twilioClient();
  if (!client) return { ok: false, error: "Twilio not configured" };
  if (!org.sms_number) return { ok: false, error: `No SMS number for ${org.name}` };
  try {
    const msg = await client.messages.create({
      from: org.sms_number,
      to: opts.to,
      body: opts.body,
      statusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`,
    });
    return { ok: true, providerMessageId: msg.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Replace {{name}}, {{link}}, {{org}} in a message body. */
export function merge(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

export function appUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}
