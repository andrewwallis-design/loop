import type { Broadcast, Channel, Respondent } from "@/lib/types";

export interface RecipientEstimate {
  total: number;
  byChannel: Partial<Record<Channel, number>>;
  excluded: { unsubscribed: number; left: number; noNewsConsent: number; noChannel: number };
}

/**
 * Who a broadcast would reach, using the same rules the sender applies:
 * in the audience, not unsubscribed, still with us, consented to news when
 * marketing, and reachable on one of the chosen channels (first in order wins).
 */
export function estimateRecipients(
  broadcast: Pick<Broadcast, "audience_types" | "channels" | "is_marketing">,
  people: Pick<Respondent, "type" | "email" | "mobile" | "unsubscribed_at" | "relationship_end" | "consent_news" | "whatsapp_opt_in">[],
): RecipientEstimate {
  const out: RecipientEstimate = { total: 0, byChannel: {}, excluded: { unsubscribed: 0, left: 0, noNewsConsent: 0, noChannel: 0 } };
  for (const p of people) {
    if (!broadcast.audience_types.includes(p.type)) continue;
    if (p.relationship_end) {
      out.excluded.left += 1;
      continue;
    }
    if (p.unsubscribed_at) {
      out.excluded.unsubscribed += 1;
      continue;
    }
    if (broadcast.is_marketing && !p.consent_news) {
      out.excluded.noNewsConsent += 1;
      continue;
    }
    const channel = pickChannel(broadcast.channels, p);
    if (!channel) {
      out.excluded.noChannel += 1;
      continue;
    }
    out.total += 1;
    out.byChannel[channel] = (out.byChannel[channel] ?? 0) + 1;
  }
  return out;
}

export function pickChannel(
  channels: Channel[],
  p: Pick<Respondent, "email" | "mobile" | "whatsapp_opt_in">,
): Channel | null {
  for (const c of channels) {
    if (c === "email" && p.email) return c;
    if (c === "whatsapp" && p.mobile && p.whatsapp_opt_in) return c;
    if (c === "sms" && p.mobile) return c;
  }
  return null;
}
