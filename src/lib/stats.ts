/**
 * Shared aggregation helpers for the dashboard and reports.
 * Everything here is plain TypeScript over rows already fetched with the
 * user-scoped client; volumes are small, so no SQL aggregation is needed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Concern, Invitation, Response, Template, TemplateQuestion } from "@/lib/types";

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type PeriodDays = 30 | 90 | 365;

export function parsePeriod(value: string | string[] | undefined, fallback: PeriodDays = 90): PeriodDays {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return n === 30 || n === 90 || n === 365 ? n : fallback;
}

export function periodStart(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** Parses a YYYY-MM-DD query value into a Date at UTC midnight, or null. */
export function parseIsoDate(value: string | string[] | undefined): Date | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days between two instants (b - a), never negative. */
export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const t1 = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  const t2 = typeof b === "string" ? new Date(b).getTime() : b.getTime();
  return Math.max(0, Math.floor((t2 - t1) / 86_400_000));
}

export interface QuarterOption {
  label: string;
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD exclusive
}

/** Last 12 months, the current quarter to date, then the four most recent completed quarters. */
export function reportPeriodOptions(now = new Date()): QuarterOption[] {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3); // 0..3
  const tomorrow = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate() + 1));
  const out: QuarterOption[] = [
    {
      label: "Last 12 months",
      from: isoDate(new Date(Date.UTC(y - 1, now.getUTCMonth(), now.getUTCDate()))),
      to: isoDate(tomorrow),
    },
  ];
  const quarterStart = (year: number, quarter: number) => new Date(Date.UTC(year, quarter * 3, 1));
  const label = (year: number, quarter: number) => `Q${quarter + 1} ${year}`;
  out.push({ label: `${label(y, q)} (to date)`, from: isoDate(quarterStart(y, q)), to: isoDate(tomorrow) });
  let yy = y;
  let qq = q;
  for (let i = 0; i < 4; i++) {
    qq -= 1;
    if (qq < 0) {
      qq = 3;
      yy -= 1;
    }
    out.push({ label: label(yy, qq), from: isoDate(quarterStart(yy, qq)), to: isoDate(quarterStart(yy, qq + 1)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface NpsResult {
  score: number | null;
  n: number;
  promoters: number;
  passives: number;
  detractors: number;
}

/** NPS from 0–10 scores: % promoters (9–10) minus % detractors (0–6), rounded. */
export function nps(scores: number[]): NpsResult {
  const n = scores.length;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const passives = n - promoters - detractors;
  return {
    n,
    promoters,
    passives,
    detractors,
    score: n === 0 ? null : Math.round(((promoters - detractors) / n) * 100),
  };
}

/** Counts per integer value from min..max (index 0 = min). */
export function distribution(values: number[], min = 1, max = 5): number[] {
  const out = Array.from({ length: max - min + 1 }, () => 0);
  for (const v of values) {
    const i = Math.round(v) - min;
    if (i >= 0 && i < out.length) out[i] += 1;
  }
  return out;
}

export function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

export function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

export function fmtMean(v: number | null, digits = 1): string {
  return v === null ? "—" : v.toFixed(digits);
}

export function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export function fmtNps(v: number | null): string {
  if (v === null) return "—";
  return v > 0 ? `+${v}` : String(v);
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type QuestionsByTemplate = Map<string, TemplateQuestion[]>;

export function indexQuestions(questions: TemplateQuestion[]): QuestionsByTemplate {
  const map: QuestionsByTemplate = new Map();
  for (const q of questions) {
    const list = map.get(q.template_id) ?? [];
    list.push(q);
    map.set(q.template_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.position - b.position);
  return map;
}

/** All numeric answers to questions of the given kind, across templates. */
export function collectAnswers(responses: Response[], byTemplate: QuestionsByTemplate, kind: "rating5" | "nps"): number[] {
  const out: number[] = [];
  for (const r of responses) {
    for (const q of byTemplate.get(r.template_id) ?? []) {
      if (q.kind !== kind) continue;
      const v = r.answers?.[q.key];
      if (typeof v === "number") out.push(v);
    }
  }
  return out;
}

/** The first rating5 answer in question order: the "headline" score for a response. */
export function headlineScore(r: Response, questions: TemplateQuestion[] | undefined): number | null {
  for (const q of questions ?? []) {
    if (q.kind !== "rating5") continue;
    const v = r.answers?.[q.key];
    if (typeof v === "number") return v;
  }
  return null;
}

export interface QuestionStat {
  key: string;
  prompt: string;
  kind: TemplateQuestion["kind"];
  n: number;
  mean: number | null;
  distribution: number[]; // rating5: counts for 1..5
  nps: NpsResult | null;
  yes: number | null; // yesno: count of true
}

/**
 * Per-question statistics for one template's questions over the responses to
 * that template. Text questions are skipped.
 */
export function groupByQuestion(questions: TemplateQuestion[], responses: Response[]): QuestionStat[] {
  const out: QuestionStat[] = [];
  for (const q of [...questions].sort((a, b) => a.position - b.position)) {
    if (q.kind === "text") continue;
    const raw = responses.filter((r) => r.template_id === q.template_id).map((r) => r.answers?.[q.key]);
    if (q.kind === "rating5" || q.kind === "nps") {
      const nums = raw.filter((v): v is number => typeof v === "number");
      out.push({
        key: q.key,
        prompt: q.prompt,
        kind: q.kind,
        n: nums.length,
        mean: q.kind === "rating5" ? mean(nums) : null,
        distribution: q.kind === "rating5" ? distribution(nums, 1, 5) : distribution(nums, 0, 10),
        nps: q.kind === "nps" ? nps(nums) : null,
        yes: null,
      });
    } else if (q.kind === "yesno") {
      const bools = raw.filter((v): v is boolean => typeof v === "boolean");
      out.push({
        key: q.key,
        prompt: q.prompt,
        kind: q.kind,
        n: bools.length,
        mean: null,
        distribution: [],
        nps: null,
        yes: bools.filter(Boolean).length,
      });
    } else {
      const strs = raw.filter((v): v is string => typeof v === "string" && v !== "");
      out.push({ key: q.key, prompt: q.prompt, kind: q.kind, n: strs.length, mean: null, distribution: [], nps: null, yes: null });
    }
  }
  return out;
}

export function themeCounts(responses: Response[]): Array<{ key: string; count: number }> {
  const all: string[] = [];
  for (const r of responses) for (const t of r.themes ?? []) all.push(t);
  return countBy(all, (t) => t);
}

/** Response rate: answered invitations over invitations actually sent. */
export function responseRate(invitations: Pick<Invitation, "status" | "sent_at" | "answered_at">[]) {
  const sent = invitations.filter((i) => i.sent_at && !["cancelled", "scheduled"].includes(i.status));
  const answered = sent.filter((i) => i.status === "answered" || i.answered_at);
  return { sent: sent.length, answered: answered.length, rate: pct(answered.length, sent.length) };
}

/** Channel a response arrived by: the invitation's channel, or derived from its source. */
export function channelOf(r: Response, invitationChannel: Map<string, string>): string {
  if (r.invitation_id && invitationChannel.has(r.invitation_id)) return invitationChannel.get(r.invitation_id)!;
  switch (r.source) {
    case "kiosk":
      return "kiosk";
    case "staff_entered":
      return "staff";
    case "letter":
      return "post";
    default:
      return "link";
  }
}

export const CHANNEL_OR_SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
  post: "Letter / post",
  kiosk: "QR / kiosk",
  staff: "Staff-entered",
  link: "Link",
};

export const SOURCE_LABEL: Record<Response["source"], string> = {
  link: "Link",
  kiosk: "QR / kiosk",
  staff_entered: "Staff-entered",
  letter: "Letter",
};

export const CONCERN_REASON_LABEL: Record<string, string> = {
  low_rating: "Low rating",
  ai_flag: "Flagged by review",
  contact_requested: "Asked to be contacted",
};

export function concernReasonLabel(reason: string): string {
  return CONCERN_REASON_LABEL[reason] ?? reason;
}

/** Maps template question keys to CQC key questions for the compliance report. */
export const CQC_KEY_QUESTION: Record<string, string> = {
  safe: "Safe",
  dignity: "Caring",
  punctual: "Responsive",
  listened: "Responsive",
  supported: "Responsive",
  call: "Responsive",
  recommend: "Well-led",
  overall: "Well-led",
};
export const CQC_ORDER = ["Safe", "Effective", "Caring", "Responsive", "Well-led", "Other"];

// ---------------------------------------------------------------------------
// Data loading (user-scoped client; RLS applies)
// ---------------------------------------------------------------------------

export interface FeedbackData {
  from: Date;
  to: Date;
  templates: Template[];
  questions: TemplateQuestion[];
  questionsByTemplate: QuestionsByTemplate;
  responses: Response[];
  invitations: Pick<Invitation, "id" | "channel" | "status" | "sent_at" | "answered_at">[];
  concerns: Concern[];
  invitationChannel: Map<string, string>;
}

/**
 * Loads everything the dashboard and reports aggregate over, for one
 * organisation and a [from, to) window on created_at / sent_at.
 * Concerns come back empty for roles below manager (RLS).
 */
export async function loadFeedbackData(
  supabase: SupabaseClient,
  organisationId: string,
  from: Date,
  to: Date = new Date(),
): Promise<FeedbackData> {
  const [tpl, resp, inv, con] = await Promise.all([
    supabase.from("templates").select("*").eq("organisation_id", organisationId).order("created_at"),
    supabase
      .from("responses")
      .select("*")
      .eq("organisation_id", organisationId)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("invitations")
      .select("id, channel, status, sent_at, answered_at")
      .eq("organisation_id", organisationId)
      .gte("sent_at", from.toISOString())
      .lt("sent_at", to.toISOString()),
    supabase
      .from("concerns")
      .select("*")
      .eq("organisation_id", organisationId)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString())
      .order("created_at", { ascending: false }),
  ]);

  const templates = (tpl.data ?? []) as Template[];
  const templateIds = templates.map((t) => t.id);
  const { data: qs } = templateIds.length
    ? await supabase.from("template_questions").select("*").in("template_id", templateIds).order("position")
    : { data: [] as TemplateQuestion[] };
  const questions = (qs ?? []) as TemplateQuestion[];
  const invitations = (inv.data ?? []) as FeedbackData["invitations"];

  return {
    from,
    to,
    templates,
    questions,
    questionsByTemplate: indexQuestions(questions),
    responses: (resp.data ?? []) as Response[],
    invitations,
    concerns: (con.data ?? []) as Concern[],
    invitationChannel: new Map(invitations.map((i) => [i.id, i.channel as string])),
  };
}
