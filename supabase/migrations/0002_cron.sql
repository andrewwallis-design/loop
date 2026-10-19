-- Loop: feedback and communication app
-- Migration 0002: call the app's scheduler endpoints from the database with pg_cron + pg_net
--
-- The Netlify-hosted app has no always-on process, so Postgres drives the schedule:
--   every 15 minutes  -> GET https://<app>/api/cron/tick
--   nightly at 03:10  -> GET https://<app>/api/cron/retention
-- Both calls carry `Authorization: Bearer <CRON_SECRET>`.
--
-- AFTER RUNNING THIS MIGRATION set the real values once (SQL editor, as the project owner):
--
--   update private.app_config
--   set app_url = 'https://loop.example.co.uk',          -- no trailing slash; same as NEXT_PUBLIC_APP_URL
--       cron_secret = '<the CRON_SECRET from the app environment>'
--   where id = 1;
--
-- The jobs read the row on every run, so changing it takes effect immediately.
-- pg_cron runs in UTC; 03:10 UTC is 03:10 GMT in winter and 04:10 BST in summer, which is fine.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Private config (not exposed through the API; the service role still reads it)
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.app_config (
  id int primary key default 1 check (id = 1),
  app_url text not null default 'https://CHANGE-ME.netlify.app',   -- set to the real app URL
  cron_secret text not null default 'CHANGE-ME',                   -- set to the real CRON_SECRET
  updated_at timestamptz not null default now()
);

insert into private.app_config (id) values (1) on conflict (id) do nothing;

revoke all on schema private from public, anon, authenticated;
revoke all on private.app_config from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helper: call an app endpoint with the bearer secret. Skips if unconfigured.
-- ---------------------------------------------------------------------------
create or replace function private.call_app_endpoint(path text) returns bigint
language plpgsql security definer set search_path = private, net, public as $$
declare
  cfg private.app_config%rowtype;
  request_id bigint;
begin
  select * into cfg from private.app_config where id = 1;
  if cfg.app_url is null or cfg.app_url like '%CHANGE-ME%' or cfg.cron_secret = 'CHANGE-ME' then
    raise notice 'private.app_config is not set; skipping %', path;
    return null;
  end if;

  select net.http_get(
    url := rtrim(cfg.app_url, '/') || path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.cron_secret,
      'Accept', 'application/json'
    ),
    timeout_milliseconds := 110000
  ) into request_id;

  return request_id;
end $$;

revoke all on function private.call_app_endpoint(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Jobs (unschedule first so re-running the migration is safe)
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('loop_tick', 'loop_retention');
exception when others then
  null;
end $$;

select cron.schedule(
  'loop_tick',
  '*/15 * * * *',
  $$ select private.call_app_endpoint('/api/cron/tick'); $$
);

select cron.schedule(
  'loop_retention',
  '10 3 * * *',
  $$ select private.call_app_endpoint('/api/cron/retention'); $$
);

-- Check what the jobs did:
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, content::text from net._http_response order by id desc limit 20;
