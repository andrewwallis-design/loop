/**
 * Unsubscribe from broadcasts (and all messages) by respondent id.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { tinyHtmlPage } from "@/lib/public-page";
import type { Organisation } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ respondentId: string }> }) {
  const { respondentId } = await context.params;
  if (!UUID.test(respondentId)) {
    return tinyHtmlPage("Unsubscribe", "This link isn't valid", "If you would like to stop receiving messages, please contact the office.");
  }
  const admin = createAdminClient();

  const { data: respondent } = await admin
    .from("respondents")
    .select("id, organisation_id")
    .eq("id", respondentId)
    .maybeSingle();

  if (!respondent) {
    return tinyHtmlPage("Unsubscribe", "This link isn't valid", "If you would like to stop receiving messages, please contact the office.");
  }

  const row = respondent as { id: string; organisation_id: string };
  const nowIso = new Date().toISOString();

  await admin
    .from("respondents")
    .update({ consent_news: false, unsubscribed_at: nowIso })
    .eq("id", row.id);

  await admin
    .from("invitations")
    .update({ status: "cancelled", error: "Unsubscribed" })
    .eq("respondent_id", row.id)
    .eq("status", "scheduled");

  const { data: org } = await admin.from("organisations").select("*").eq("id", row.organisation_id).single();
  const o = org as Organisation | null;
  const name = o?.short_name ?? o?.name ?? "us";

  return tinyHtmlPage(
    "Unsubscribed",
    "You're unsubscribed",
    `You won't receive further messages from ${name}. If you change your mind, just let the office know.`,
    o?.brand_colour,
  );
}
