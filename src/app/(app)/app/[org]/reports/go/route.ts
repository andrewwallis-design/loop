import { NextResponse, type NextRequest } from "next/server";

/** Turns the report picker's GET form into /reports/<kind>?from=&to=. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const url = request.nextUrl;
  const kind = url.searchParams.get("kind") === "team" ? "team" : "compliance";
  const [from, to] = (url.searchParams.get("period") ?? "").split("_");
  const ok = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const target = new URL(`/app/${org}/reports/${kind}`, url.origin);
  if (ok(from) && ok(to)) {
    target.searchParams.set("from", from!);
    target.searchParams.set("to", to!);
  }
  return NextResponse.redirect(target);
}
