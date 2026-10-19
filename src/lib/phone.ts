/**
 * Phone number helpers. Numbers are stored in E.164 (`+447700900123`).
 * UK numbers are assumed when no country code is given.
 */

/** Normalises a typed number to E.164, or returns null when it cannot be read as a phone number. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) {
    return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
  }
  if (!/^\d+$/.test(s)) return null;
  // UK national format: 07700 900123, 01789 123456
  if (/^0\d{9,10}$/.test(s)) return `+44${s.slice(1)}`;
  // 44 without the plus
  if (/^44\d{9,10}$/.test(s)) return `+${s}`;
  // UK mobile with the leading zero dropped (common in spreadsheets)
  if (/^7\d{9}$/.test(s)) return `+44${s}`;
  return null;
}

/** True for a UK mobile (+447…), the only numbers we send SMS/WhatsApp to by default. */
export function isUkMobile(e164: string | null | undefined): boolean {
  return !!e164 && /^\+447\d{9}$/.test(e164);
}

/** Friendly display: +447700900123 -> 07700 900123; other countries unchanged. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+44(\d{4})(\d{6})$/.exec(e164);
  if (m) return `0${m[1]} ${m[2]}`;
  return e164;
}
