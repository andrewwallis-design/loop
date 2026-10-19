export type MemberRole = "viewer" | "staff" | "manager" | "owner";
export type RespondentType = "client" | "next_of_kin" | "carer" | "pilot" | "patient" | "other";
export type QuestionKind = "rating5" | "nps" | "yesno" | "choice" | "text";
export type TriggerKind = "adhoc" | "event_relative" | "calendar";
export type Channel = "email" | "whatsapp" | "sms" | "post" | "kiosk" | "staff";
export type InvitationStatus =
  | "scheduled" | "sent" | "delivered" | "opened" | "answered" | "bounced" | "failed" | "cancelled";
export type CampaignStatus = "draft" | "active" | "paused" | "done";
export type ConcernStatus = "open" | "in_progress" | "closed";
export type ResponseSource = "link" | "kiosk" | "staff_entered" | "letter";

export const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, staff: 2, manager: 3, owner: 4 };

export const RESPONDENT_TYPE_LABEL: Record<RespondentType, string> = {
  client: "Client",
  next_of_kin: "Next of kin",
  carer: "Carer",
  pilot: "Pilot",
  patient: "Patient",
  other: "Other",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
  post: "Post",
  kiosk: "QR / kiosk",
  staff: "Staff-entered",
};

export interface Organisation {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  respondent_noun: string;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  whatsapp_number: string | null;
  sms_number: string | null;
  brand_colour: string;
  concern_owner_user_id: string | null;
  concern_deputy_user_id: string | null;
  quiet_hours_start: string;
  quiet_hours_end: string;
  retention_responses_months: number;
  retention_contacts_months: number;
  retention_broadcast_log_months: number;
  kiosk_template_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  is_owner: boolean;
}

export interface Membership {
  id: string;
  organisation_id: string;
  user_id: string;
  role: MemberRole;
  expires_at: string | null;
}

export interface Respondent {
  id: string;
  organisation_id: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  type: RespondentType;
  relates_to: string | null;
  consent_feedback: boolean;
  consent_news: boolean;
  unsubscribed_at: string | null;
  whatsapp_opt_in: boolean;
  external_ref: string | null;
  relationship_start: string | null;
  relationship_end: string | null;
  event_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  organisation_id: string;
  lineage_id: string;
  version: number;
  name: string;
  audience: RespondentType;
  is_pulse: boolean;
  intro: string | null;
  anonymity_choice: boolean;
  non_performance_statement: boolean;
  thank_you: string;
  is_current: boolean;
  created_at: string;
}

export interface TemplateQuestion {
  id: string;
  template_id: string;
  position: number;
  key: string;
  kind: QuestionKind;
  prompt: string;
  options: string[] | null;
  required: boolean;
}

export interface Campaign {
  id: string;
  organisation_id: string;
  template_id: string;
  name: string;
  trigger_kind: TriggerKind;
  event_field: "relationship_start" | "event_date" | null;
  offset_days: number | null;
  schedule_cron: string | null;
  audience_types: RespondentType[];
  channels: Channel[];
  message: string | null;
  reminder_after_days: number;
  min_days_between_surveys: number;
  status: CampaignStatus;
  test_sent_at: string | null;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Invitation {
  id: string;
  organisation_id: string;
  campaign_id: string;
  respondent_id: string;
  template_id: string;
  token: string;
  channel: Channel;
  scheduled_for: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  answered_at: string | null;
  bounced_at: string | null;
  reminder_sent_at: string | null;
  status: InvitationStatus;
  provider_message_id: string | null;
  error: string | null;
}

export type AnswerValue = number | string | boolean | null;

export interface Response {
  id: string;
  organisation_id: string;
  template_id: string;
  invitation_id: string | null;
  respondent_id: string | null;
  contactable: boolean;
  source: ResponseSource;
  entered_by: string | null;
  answers: Record<string, AnswerValue>;
  free_text: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  themes: string[];
  concern: boolean;
  concern_reason: string | null;
  ai_processed_at: string | null;
  anonymised_at: string | null;
  created_at: string;
}

export interface Concern {
  id: string;
  organisation_id: string;
  response_id: string;
  reason: string;
  summary: string | null;
  status: ConcernStatus;
  owner_user_id: string | null;
  alerted_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  closure_note: string | null;
  created_at: string;
}

export interface Broadcast {
  id: string;
  organisation_id: string;
  subject: string;
  body: string;
  attachment_url: string | null;
  audience_types: RespondentType[];
  channels: Channel[];
  is_marketing: boolean;
  status: "draft" | "sending" | "sent";
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}
