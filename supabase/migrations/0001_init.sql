-- Loop: feedback and communication app
-- Migration 0001: core schema, roles, row-level security, seed for Alcester HomeCare
-- Run with: supabase db push   (or paste into the Supabase SQL editor)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_role as enum ('viewer', 'staff', 'manager', 'owner');
create type respondent_type as enum ('client', 'next_of_kin', 'carer', 'pilot', 'patient', 'other');
create type question_kind as enum ('rating5', 'nps', 'yesno', 'choice', 'text');
create type trigger_kind as enum ('adhoc', 'event_relative', 'calendar');
create type channel as enum ('email', 'whatsapp', 'sms', 'post', 'kiosk', 'staff');
create type invitation_status as enum ('scheduled', 'sent', 'delivered', 'opened', 'answered', 'bounced', 'failed', 'cancelled');
create type campaign_status as enum ('draft', 'active', 'paused', 'done');
create type concern_status as enum ('open', 'in_progress', 'closed');
create type response_source as enum ('link', 'kiosk', 'staff_entered', 'letter');

-- ---------------------------------------------------------------------------
-- App settings (single row)
-- ---------------------------------------------------------------------------
create table app_settings (
  id int primary key default 1 check (id = 1),
  owner_email text not null,
  app_name text not null default 'Loop',
  base_url text not null default 'http://localhost:3000'
);

-- ---------------------------------------------------------------------------
-- Organisations (tenants)
-- ---------------------------------------------------------------------------
create table organisations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text,
  logo_url text,
  respondent_noun text not null default 'client',        -- client / pilot / patient
  from_name text,
  from_email text,                                        -- e.g. feedback@feedback.alcesterhomecareagency.co.uk
  reply_to text,                                          -- e.g. feedback@alcesterhomecareagency.co.uk
  whatsapp_number text,                                   -- E.164, e.g. +447700900000
  sms_number text,
  brand_colour text not null default '#1f5f8b',
  concern_owner_user_id uuid,
  concern_deputy_user_id uuid,
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '08:00',
  retention_responses_months int not null default 36,
  retention_contacts_months int not null default 12,
  retention_broadcast_log_months int not null default 12,
  kiosk_template_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Users and membership
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role member_role not null default 'staff',
  expires_at timestamptz,                                 -- time-limited viewer logins
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

alter table organisations
  add constraint organisations_concern_owner_fk foreign key (concern_owner_user_id) references profiles (id) on delete set null,
  add constraint organisations_concern_deputy_fk foreign key (concern_deputy_user_id) references profiles (id) on delete set null;

-- Create a profile row for every new auth user; owner if the email matches app_settings.owner_email
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, is_owner)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    exists (select 1 from app_settings where lower(owner_email) = lower(new.email))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Respondents (scoped per organisation; never shared)
-- ---------------------------------------------------------------------------
create table respondents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  full_name text not null,
  email text,
  mobile text,                                            -- E.164
  type respondent_type not null default 'client',
  relates_to text,                                        -- for next of kin: who they are next of kin to
  consent_feedback boolean not null default true,
  consent_news boolean not null default false,
  unsubscribed_at timestamptz,
  whatsapp_opt_in boolean not null default false,
  external_ref text,                                      -- ACP client id, booking ref
  relationship_start date,
  relationship_end date,
  event_date date,                                        -- medical date, treatment date
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or mobile is not null)
);
create unique index respondents_org_email_idx on respondents (organisation_id, lower(email)) where email is not null;
create unique index respondents_org_mobile_idx on respondents (organisation_id, mobile) where mobile is not null;
create index respondents_org_idx on respondents (organisation_id);

-- ---------------------------------------------------------------------------
-- Survey templates (versioned)
-- ---------------------------------------------------------------------------
create table templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),     -- shared across versions of the same template
  version int not null default 1,
  name text not null,
  audience respondent_type not null default 'client',
  is_pulse boolean not null default false,
  intro text,
  anonymity_choice boolean not null default true,
  non_performance_statement boolean not null default false, -- carer surveys
  thank_you text not null default 'Thank you. Your feedback has been received.',
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lineage_id, version)
);
create index templates_org_idx on templates (organisation_id);

create table template_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates (id) on delete cascade,
  position int not null,
  key text not null,                                      -- stable across versions; trends join on (lineage_id, key, prompt)
  kind question_kind not null,
  prompt text not null,
  options jsonb,                                          -- for 'choice'
  required boolean not null default false,
  unique (template_id, key)
);

-- ---------------------------------------------------------------------------
-- Campaigns and triggers
-- ---------------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  template_id uuid not null references templates (id),
  name text not null,
  trigger_kind trigger_kind not null default 'adhoc',
  event_field text check (event_field in ('relationship_start', 'event_date')),
  offset_days int,                                        -- event_relative: fire N days after event_field
  schedule_cron text,                                     -- calendar: 5-field cron, UK time
  audience_types respondent_type[] not null default '{client}',
  channels channel[] not null default '{email}',          -- in order of preference
  message text,                                           -- invitation wording; {{name}} and {{link}} merged
  reminder_after_days int not null default 5,
  min_days_between_surveys int not null default 30,
  status campaign_status not null default 'draft',
  test_sent_at timestamptz,
  last_run_at timestamptz,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index campaigns_org_idx on campaigns (organisation_id);

-- ---------------------------------------------------------------------------
-- Invitations (one per respondent per campaign)
-- ---------------------------------------------------------------------------
create table invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  respondent_id uuid not null references respondents (id) on delete cascade,
  template_id uuid not null references templates (id),
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  channel channel not null,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  answered_at timestamptz,
  bounced_at timestamptz,
  reminder_sent_at timestamptz,
  status invitation_status not null default 'scheduled',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (campaign_id, respondent_id)
);
create index invitations_due_idx on invitations (status, scheduled_for);
create index invitations_org_idx on invitations (organisation_id);

-- ---------------------------------------------------------------------------
-- Responses
-- ---------------------------------------------------------------------------
create table responses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  template_id uuid not null references templates (id),
  invitation_id uuid references invitations (id) on delete set null,
  respondent_id uuid references respondents (id) on delete set null, -- only when contactable
  contactable boolean not null default false,
  source response_source not null default 'link',
  entered_by uuid references profiles (id),               -- staff-entered telephone/letter responses
  answers jsonb not null default '{}'::jsonb,             -- { "<question key>": value }
  free_text text,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  themes text[] not null default '{}',
  concern boolean not null default false,
  concern_reason text,
  ai_processed_at timestamptz,
  anonymised_at timestamptz,
  created_at timestamptz not null default now()
);
create index responses_org_created_idx on responses (organisation_id, created_at desc);
create index responses_template_idx on responses (template_id);

-- ---------------------------------------------------------------------------
-- Concern queue
-- ---------------------------------------------------------------------------
create table concerns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  response_id uuid not null references responses (id) on delete cascade,
  reason text not null,                                   -- 'low_rating' | 'ai_flag' | 'contact_requested'
  summary text,
  status concern_status not null default 'open',
  owner_user_id uuid references profiles (id),
  alerted_at timestamptz,
  closed_by uuid references profiles (id),
  closed_at timestamptz,
  closure_note text,
  created_at timestamptz not null default now()
);
create index concerns_org_status_idx on concerns (organisation_id, status);

-- ---------------------------------------------------------------------------
-- Broadcasts (information out)
-- ---------------------------------------------------------------------------
create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  subject text not null,
  body text not null,                                     -- markdown; {{name}} merged
  attachment_url text,
  audience_types respondent_type[] not null default '{client}',
  channels channel[] not null default '{email}',
  is_marketing boolean not null default false,            -- true => requires consent_news
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent')),
  sent_at timestamptz,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references broadcasts (id) on delete cascade,
  respondent_id uuid not null references respondents (id) on delete cascade,
  channel channel not null,
  sent_at timestamptz,
  status text not null default 'queued',
  provider_message_id text,
  error text,
  unique (broadcast_id, respondent_id)
);

-- ---------------------------------------------------------------------------
-- Audit: every view of an identifiable response, plus admin actions
-- ---------------------------------------------------------------------------
create table access_log (
  id bigserial primary key,
  organisation_id uuid references organisations (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  action text not null,                                   -- 'view_response', 'close_concern', 'send_campaign', ...
  entity text,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index access_log_org_idx on access_log (organisation_id, created_at desc);

-- Provider webhook events (Resend, Twilio) kept raw for debugging
create table message_events (
  id bigserial primary key,
  provider text not null,
  provider_message_id text,
  event text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index message_events_pm_idx on message_events (provider_message_id);

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
create or replace function role_rank(r member_role) returns int
language sql immutable as $$
  select case r when 'viewer' then 1 when 'staff' then 2 when 'manager' then 3 when 'owner' then 4 end
$$;

create or replace function is_app_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from profiles where id = auth.uid()), false)
$$;

-- True if the current user is a member of org with at least the given role (or is the app owner)
create or replace function has_role(org uuid, min_role member_role) returns boolean
language sql stable security definer set search_path = public as $$
  select is_app_owner() or exists (
    select 1 from memberships m
    where m.organisation_id = org
      and m.user_id = auth.uid()
      and (m.expires_at is null or m.expires_at > now())
      and role_rank(m.role) >= role_rank(min_role)
  )
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table organisations enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table respondents enable row level security;
alter table templates enable row level security;
alter table template_questions enable row level security;
alter table campaigns enable row level security;
alter table invitations enable row level security;
alter table responses enable row level security;
alter table concerns enable row level security;
alter table broadcasts enable row level security;
alter table broadcast_recipients enable row level security;
alter table access_log enable row level security;
alter table message_events enable row level security;

-- app_settings: owner only
create policy app_settings_owner on app_settings for all using (is_app_owner()) with check (is_app_owner());

-- organisations: visible to members; editable by managers; created by the app owner
create policy organisations_select on organisations for select using (has_role(id, 'viewer'));
create policy organisations_update on organisations for update using (has_role(id, 'manager'));
create policy organisations_insert on organisations for insert with check (is_app_owner());

-- profiles: see yourself, and anyone who shares an organisation with you
create policy profiles_select on profiles for select using (
  id = auth.uid() or is_app_owner() or exists (
    select 1 from memberships a join memberships b on a.organisation_id = b.organisation_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update_self on profiles for update using (id = auth.uid());

-- memberships: see your own and your organisations'; managers manage
create policy memberships_select on memberships for select using (user_id = auth.uid() or has_role(organisation_id, 'viewer'));
create policy memberships_manage on memberships for all using (has_role(organisation_id, 'manager')) with check (has_role(organisation_id, 'manager'));

-- respondents: staff and above
create policy respondents_select on respondents for select using (has_role(organisation_id, 'staff'));
create policy respondents_write on respondents for insert with check (has_role(organisation_id, 'staff'));
create policy respondents_update on respondents for update using (has_role(organisation_id, 'staff'));
create policy respondents_delete on respondents for delete using (has_role(organisation_id, 'manager'));

-- templates and questions: viewers read, managers write
create policy templates_select on templates for select using (has_role(organisation_id, 'viewer'));
create policy templates_write on templates for all using (has_role(organisation_id, 'manager')) with check (has_role(organisation_id, 'manager'));
create policy template_questions_select on template_questions for select using (
  exists (select 1 from templates t where t.id = template_id and has_role(t.organisation_id, 'viewer')));
create policy template_questions_write on template_questions for all using (
  exists (select 1 from templates t where t.id = template_id and has_role(t.organisation_id, 'manager')))
  with check (exists (select 1 from templates t where t.id = template_id and has_role(t.organisation_id, 'manager')));

-- campaigns: staff read and create (ad hoc sends); managers full control
create policy campaigns_select on campaigns for select using (has_role(organisation_id, 'staff'));
create policy campaigns_insert on campaigns for insert with check (has_role(organisation_id, 'staff'));
create policy campaigns_update on campaigns for update using (has_role(organisation_id, 'manager'));
create policy campaigns_delete on campaigns for delete using (has_role(organisation_id, 'manager'));

-- invitations: staff read; writes happen server-side with the service role
create policy invitations_select on invitations for select using (has_role(organisation_id, 'staff'));
create policy invitations_insert on invitations for insert with check (has_role(organisation_id, 'staff'));

-- responses: viewers see rows (app layer strips identity for staff/viewer); managers everything
create policy responses_select on responses for select using (has_role(organisation_id, 'viewer'));
create policy responses_insert_staff on responses for insert with check (has_role(organisation_id, 'staff') and source = 'staff_entered');

-- concerns: managers only
create policy concerns_all on concerns for all using (has_role(organisation_id, 'manager')) with check (has_role(organisation_id, 'manager'));

-- broadcasts: managers
create policy broadcasts_all on broadcasts for all using (has_role(organisation_id, 'manager')) with check (has_role(organisation_id, 'manager'));
create policy broadcast_recipients_select on broadcast_recipients for select using (
  exists (select 1 from broadcasts b where b.id = broadcast_id and has_role(b.organisation_id, 'manager')));

-- access log: managers read their organisation's; everyone can write their own entries
create policy access_log_select on access_log for select using (has_role(organisation_id, 'manager'));
create policy access_log_insert on access_log for insert with check (user_id = auth.uid());

-- message_events: app owner only (service role bypasses RLS anyway)
create policy message_events_owner on message_events for select using (is_app_owner());

-- ---------------------------------------------------------------------------
-- Anonymised view for Staff/Viewer roles: scores and comments, no identity
-- ---------------------------------------------------------------------------
create view responses_anonymised as
  select id, organisation_id, template_id, source, answers, free_text, sentiment, themes, concern, created_at
  from responses;

-- ---------------------------------------------------------------------------
-- Retention: run nightly (pg_cron or the /api/cron/retention endpoint)
-- ---------------------------------------------------------------------------
create or replace function run_retention() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Responses past retention: drop the link to the person, keep scores and comments
  update responses r
  set respondent_id = null, invitation_id = null, contactable = false, anonymised_at = now()
  from organisations o
  where r.organisation_id = o.id
    and r.anonymised_at is null
    and r.created_at < now() - (o.retention_responses_months || ' months')::interval;

  -- Contacts: delete N months after the relationship ended, unless a concern is still open
  delete from respondents p
  using organisations o
  where p.organisation_id = o.id
    and p.relationship_end is not null
    and p.relationship_end < (now() - (o.retention_contacts_months || ' months')::interval)::date
    and not exists (
      select 1 from concerns c join responses r on r.id = c.response_id
      where r.respondent_id = p.id and c.status <> 'closed');

  -- Broadcast logs
  delete from broadcast_recipients br
  using broadcasts b, organisations o
  where br.broadcast_id = b.id and b.organisation_id = o.id
    and b.sent_at < now() - (o.retention_broadcast_log_months || ' months')::interval;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger respondents_touch before update on respondents for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: app settings and Alcester HomeCare Agency with the starting template library
-- ---------------------------------------------------------------------------
insert into app_settings (id, owner_email) values (1, 'andrew.wallis@alcesterhomecareagency.co.uk')
on conflict (id) do nothing;

insert into organisations (id, slug, name, short_name, respondent_noun, from_name, reply_to)
values ('11111111-1111-4111-8111-111111111111', 'ahca', 'Alcester HomeCare Agency', 'Alcester HomeCare', 'client',
        'Alcester HomeCare', 'feedback@alcesterhomecareagency.co.uk');

-- Clients and next of kin
insert into templates (id, organisation_id, lineage_id, name, audience, intro)
values ('22222222-0001-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-0001-4000-8000-000000000001',
        'Client and family feedback', 'client',
        'We would like to know how we are doing. This takes about two minutes.');
insert into template_questions (template_id, position, key, kind, prompt, required) values
  ('22222222-0001-4000-8000-000000000001', 1, 'overall',   'rating5', 'Overall, how satisfied are you with the care you receive?', true),
  ('22222222-0001-4000-8000-000000000001', 2, 'punctual',  'rating5', 'Our carers arrive on time', false),
  ('22222222-0001-4000-8000-000000000001', 3, 'dignity',   'rating5', 'Our carers treat you with dignity and respect', false),
  ('22222222-0001-4000-8000-000000000001', 4, 'safe',      'rating5', 'You feel safe with the care you receive', false),
  ('22222222-0001-4000-8000-000000000001', 5, 'recommend', 'nps',     'How likely are you to recommend us to a friend or family member?', false),
  ('22222222-0001-4000-8000-000000000001', 6, 'comments',  'text',    'Is there anything we should know, or anything we could do better?', false);

-- Carers
insert into templates (id, organisation_id, lineage_id, name, audience, intro, non_performance_statement)
values ('22222222-0001-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '33333333-0001-4000-8000-000000000002',
        'Carer feedback', 'carer',
        'We want to hear how it is for you. Your answers help us run the office better.', true);
insert into template_questions (template_id, position, key, kind, prompt, required) values
  ('22222222-0001-4000-8000-000000000002', 1, 'supported', 'rating5', 'I feel supported by the office', true),
  ('22222222-0001-4000-8000-000000000002', 2, 'equipped',  'rating5', 'I have the training and time to do my visits properly', false),
  ('22222222-0001-4000-8000-000000000002', 3, 'listened',  'rating5', 'When I raise a concern it is listened to and acted on', false),
  ('22222222-0001-4000-8000-000000000002', 4, 'recommend', 'nps',     'How likely are you to recommend us as a place to work?', false),
  ('22222222-0001-4000-8000-000000000002', 5, 'comments',  'text',    'Is there anything we should know?', false);

-- Pulse: after a visit
insert into templates (id, organisation_id, lineage_id, name, audience, is_pulse, intro)
values ('22222222-0001-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '33333333-0001-4000-8000-000000000003',
        'Pulse: how was today''s visit?', 'client', true, null);
insert into template_questions (template_id, position, key, kind, prompt, required) values
  ('22222222-0001-4000-8000-000000000003', 1, 'visit',    'rating5', 'How was today''s visit?', true),
  ('22222222-0001-4000-8000-000000000003', 2, 'comments', 'text',    'Anything you would like to add?', false);

-- Pulse: after a call to the office
insert into templates (id, organisation_id, lineage_id, name, audience, is_pulse)
values ('22222222-0001-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '33333333-0001-4000-8000-000000000004',
        'Pulse: how was your call with the office?', 'client', true);
insert into template_questions (template_id, position, key, kind, prompt, required) values
  ('22222222-0001-4000-8000-000000000004', 1, 'call',     'rating5', 'How was your call with the office?', true),
  ('22222222-0001-4000-8000-000000000004', 2, 'comments', 'text',    'Anything you would like to add?', false);

update organisations set kiosk_template_id = '22222222-0001-4000-8000-000000000001'
where id = '11111111-1111-4111-8111-111111111111';
