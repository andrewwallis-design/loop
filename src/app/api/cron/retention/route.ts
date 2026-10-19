/**
 * Nightly retention run (anonymise old responses, delete lapsed contacts).
 * Called by Supabase pg_cron at 03:10 with `Authorization: Bearer $CRON_SECRET`.
 */
import { isCronAuthorised, unauthorised } from "@/lib/cron-auth";
import { runRetention } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!isCronAuthorised(request)) return unauthorised();
  try {
    await runRetention();
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
