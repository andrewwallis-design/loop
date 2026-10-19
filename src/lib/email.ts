import type { Organisation } from "@/lib/types";
import { escapeHtml } from "@/lib/responses";

/** Display name for an organisation in messages. */
export function orgDisplayName(org: Organisation): string {
  return org.short_name ?? org.name;
}

/** First word of a full name, for greetings. */
export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || fullName;
}

/**
 * Turns plain text into simple HTML: blank lines separate paragraphs, single
 * line breaks become <br>, and anything that looks like a URL becomes a link.
 * Text is escaped first, so it is safe for user-authored content.
 */
export function textToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return paragraphs
    .filter((p) => p.trim().length > 0)
    .map((p) => {
      const escaped = escapeHtml(p)
        .replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" style="color:#1f5f8b">${url}</a>`)
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px 0;font-size:16px;line-height:1.5;color:#222">${escaped}</p>`;
    })
    .join("");
}

/**
 * Shared email wrapper: brand colour bar with the organisation name, a white
 * card for the body and a grey footer.
 */
export function emailShell(org: Organisation, bodyHtml: string, footerHtml: string): string {
  const colour = /^#[0-9a-fA-F]{3,8}$/.test(org.brand_colour) ? org.brand_colour : "#1f5f8b";
  const logo = org.logo_url
    ? `<img src="${escapeHtml(org.logo_url)}" alt="" height="36" style="height:36px;vertical-align:middle;margin-right:12px">`
    : "";
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(org.name)}</title></head>
<body style="margin:0;padding:0;background:#f4f3f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:${colour};padding:16px 24px;color:#ffffff;font-size:18px;font-weight:600">${logo}${escapeHtml(org.name)}</td></tr>
<tr><td style="padding:28px 24px 8px 24px">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px 24px 24px;border-top:1px solid #eeeae4;font-size:12px;line-height:1.5;color:#777">${footerHtml}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** A large call-to-action button. */
export function emailButton(href: string, label: string, colour: string): string {
  const c = /^#[0-9a-fA-F]{3,8}$/.test(colour) ? colour : "#1f5f8b";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto"><tr><td style="background:${c};border-radius:8px">
<a href="${href}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:17px;font-weight:600;text-decoration:none">${escapeHtml(label)}</a>
</td></tr></table>`;
}
