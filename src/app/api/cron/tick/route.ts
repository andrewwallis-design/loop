/**
 * Scheduler tick. Called every 15 minutes by Supabase pg_cron (see
 * supabase/migrations/0002_cron.sql) with `Authorization: Bearer $CRON_SECRET`.
 */
import { isCronAuthorised, unauthorised } from "@/lib/cron-auth";
import { runScheduledCampaigns, processDueInvitations, sendReminders } from "@/lib/scheduler";
import { classifyPendingResponses } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface StepResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function step<T extends Record<string, unknown>>(fn: () => Promise<T>): Promise<StepResult> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function tick(request: Request): Promise<Response> {
  if (!isCronAuthorised(request)) return unauthorised();
  const started = Date.now();
  const now = new Date();

  const campaigns = await step(() => runScheduledCampaigns(now));
  const invitations = await step(() => processDueInvitations({ limit: 100, now }));
  const reminders = await step(() => sendReminders(now));
  const ai = await step(() => classifyPendingResponses(25));

  return Response.json({
    at: now.toISOString(),
    ms: Date.now() - started,
    campaigns,
    invitations,
    reminders,
    ai,
  });
}

export async function GET(request: Request) {
  return tick(request);
}

export async function POST(request: Request) {
  return tick(request);
}
