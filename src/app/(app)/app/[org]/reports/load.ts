import { requireOrg, type OrgAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { loadFeedbackData, parseIsoDate, type FeedbackData } from "@/lib/stats";

export interface ReportContext {
  access: OrgAccess;
  data: FeedbackData;
  periodLabel: string;
}

/** Resolves ?from=&to= (to exclusive; defaults to the last 12 months) and loads the data. */
export async function loadReport(slug: string, sp: { from?: string; to?: string }): Promise<ReportContext> {
  const access = await requireOrg(slug);
  const now = new Date();
  const to = parseIsoDate(sp.to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = parseIsoDate(sp.from) ?? new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()));
  const supabase = await createClient();
  const data = await loadFeedbackData(supabase, access.org.id, from, to);
  const lastDay = new Date(to.getTime() - 86_400_000);
  return { access, data, periodLabel: `${formatDate(from)} to ${formatDate(lastDay)}` };
}
