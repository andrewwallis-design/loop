/**
 * Europe/London time helpers and a small 5-field cron matcher.
 * No date libraries: everything goes through Intl.DateTimeFormat parts.
 */

export const LONDON = "Europe/London";

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: number; // 0 = Sunday ... 6 = Saturday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

/** Breaks an instant into London wall-clock parts. */
export function londonParts(date: Date): WallClock {
  const parts = londonFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** London calendar date as YYYY-MM-DD. */
export function londonDateString(date: Date): string {
  const p = londonParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Converts a London wall-clock time to a UTC instant. Handles BST/GMT by
 * guessing the UTC instant and correcting for the observed offset (twice,
 * which covers DST transitions).
 */
export function londonToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = londonParts(new Date(guess));
    const observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - observed;
  }
  return new Date(guess);
}

/** Adds whole days to a YYYY-MM-DD date string (calendar arithmetic, no time zone). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Parses a Postgres `time` value ("20:00" or "20:00:00") into minutes past midnight. */
export function parseClock(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * True when `now` (in London time) falls inside the quiet window start..end.
 * The window may wrap midnight (e.g. 20:00 -> 08:00). Equal start and end means
 * no quiet hours.
 */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === e) return false;
  const p = londonParts(now);
  const cur = p.hour * 60 + p.minute;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** The next instant at which quiet hours end (London time), at or after `now`. */
export function nextQuietHoursEnd(now: Date, end: string): Date {
  const e = parseClock(end);
  const p = londonParts(now);
  let candidate = londonToUtc(p.year, p.month, p.day, Math.floor(e / 60), e % 60);
  if (candidate.getTime() <= now.getTime()) {
    const next = addDays(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, 1);
    const [y, m, d] = next.split("-").map(Number);
    candidate = londonToUtc(y, m, d, Math.floor(e / 60), e % 60);
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`Empty cron field in "${field}"`);
    const [rangePart, stepPart] = trimmed.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${trimmed}"`);
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Cron value out of range in "${trimmed}"`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parses "minute hour day month weekday". Supports *, lists, ranges and steps. */
export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron needs 5 fields, got "${expr}"`);
  const weekday = parseField(fields[4], 0, 7);
  if (weekday.has(7)) {
    weekday.delete(7);
    weekday.add(0);
  }
  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    day: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    weekday,
  };
}

/** Does a cron spec match the given London wall-clock minute? */
export function cronMatches(spec: CronSpec, p: WallClock): boolean {
  return (
    spec.minute.has(p.minute) &&
    spec.hour.has(p.hour) &&
    spec.day.has(p.day) &&
    spec.month.has(p.month) &&
    spec.weekday.has(p.weekday)
  );
}

/**
 * True if any minute strictly after `since` and up to and including `now`
 * (evaluated in London time) matches the cron expression. The window is capped
 * at 24 hours so a long-dormant campaign cannot scan weeks of minutes.
 * Returns false (and does not throw) for an unparseable expression.
 */
export function cronDueBetween(expr: string, since: Date, now: Date): boolean {
  let spec: CronSpec;
  try {
    spec = parseCron(expr);
  } catch {
    return false;
  }
  const floorMinute = (t: number) => Math.floor(t / 60_000) * 60_000;
  const end = floorMinute(now.getTime());
  const earliest = end - 24 * 60 * 60_000;
  let t = Math.max(floorMinute(since.getTime()) + 60_000, earliest);
  for (; t <= end; t += 60_000) {
    if (cronMatches(spec, londonParts(new Date(t)))) return true;
  }
  return false;
}
