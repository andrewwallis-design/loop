/**
 * One-click unsubscribe from feedback requests, by invitation token.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { tinyHtmlPage } from "@/lib/public-page";
import type { Organisation } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const admin = createAdminClient();

  const { data: invitation } = await admin
    .from("invitations")
    .select("id, respondent_id, organisation_id")
    .eq("token", token)
    .maybeSingle();

  if (!invitation) {
    return tinyHtmlPage("Unsubscribe", "This link isn't valid", "If you would like to stop receiving feedback requests, please contact the office.");
  }

  const row = invitation as { id: string; respondent_id: string; organisation_id: string };
  const nowIso = new Date().toISOString();

  await admin
    .from("respondents")
    .update({ unsubscribed_at: nowIso })
    .eq("id", row.respondent_id)
    .is("unsubscribed_at", null);

  // Cancel anything still waiting to go out to this person
  await admin
    .from("invitations")
    .update({ status: "cancelled", error: "Unsubscribed" })
    .eq("respondent_id", row.respondent_id)
    .eq("status", "scheduled");

  const { data: org } = await admin.from("organisations").select("*").eq("id", row.organisation_id).single();
  const o = org as Organisation | null;
  const name = o?.short_name ?? o?.name ?? "us";

  return tinyHtmlPage(
    "Unsubscribed",
    "You're unsubscribed",
    `You won't receive further feedback requests from ${name}. If you change your mind, just let the office know.`,
    o?.brand_colour,
  );
}
