import { escapeHtml } from "@/lib/responses";

/** A tiny standalone HTML page for route handlers (unsubscribe confirmations). */
export function tinyHtmlPage(title: string, heading: string, body: string, brandColour = "#1f5f8b"): Response {
  const colour = /^#[0-9a-fA-F]{3,8}$/.test(brandColour) ? brandColour : "#1f5f8b";
  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#f4f3f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222}
.bar{height:6px;background:${colour}}
main{max-width:520px;margin:48px auto;padding:0 20px}
.card{background:#fff;border-radius:12px;padding:28px 24px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:22px;margin:0 0 10px}
p{font-size:16px;line-height:1.5;margin:0;color:#444}
</style></head>
<body><div class="bar"></div><main><div class="card"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p></div></main></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
