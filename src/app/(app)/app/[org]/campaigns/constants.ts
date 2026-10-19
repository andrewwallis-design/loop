import type { CampaignStatus, InvitationStatus, TriggerKind } from "@/lib/types";

export const DEFAULT_MESSAGE = "Hi {{name}}, we'd love to know how we're doing at {{org}}. It takes two minutes: {{link}}";

export const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Quarterly: 1 Jan, Apr, Jul, Oct at 10:07", value: "7 10 1 1,4,7,10 *" },
  { label: "Annually: 1 February at 10:07", value: "7 10 1 2 *" },
  { label: "Monthly: 1st of the month at 10:07", value: "7 10 1 * *" },
];

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  adhoc: "Ad hoc",
  event_relative: "After an event",
  calendar: "On a schedule",
};

export const STATUS_BADGE: Record<CampaignStatus, string> = {
  draft: "bg-stone-200 text-stone-700",
  active: "bg-green-100 text-green-800",
  paused: "bg-amber-100 text-amber-800",
  done: "bg-sky-100 text-sky-800",
};

export const INVITATION_BADGE: Record<InvitationStatus, string> = {
  scheduled: "bg-stone-100 text-stone-700",
  sent: "bg-sky-100 text-sky-800",
  delivered: "bg-sky-100 text-sky-800",
  opened: "bg-indigo-100 text-indigo-800",
  answered: "bg-green-100 text-green-800",
  bounced: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-stone-200 text-stone-600",
};

/** Describes a cron expression in plain words where it matches a preset; otherwise returns it as is. */
export function describeCron(expr: string | null): string {
  if (!expr) return "—";
  const preset = CRON_PRESETS.find((p) => p.value === expr.trim());
  return preset ? preset.label : expr;
}
