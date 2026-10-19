# Loop

Ask, listen, act, tell. A multi-organisation feedback and communication app: send surveys to clients, next of kin, carers or pilots (ad hoc or triggered by a date), collect answers by email, WhatsApp, SMS or post, flag concerns the same day, analyse the results, and send information back out.

Built for Alcester HomeCare Agency first; Fit 2 Fly Medicals and others are added as organisations in Settings.

## What's where

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | Database schema, row-level security, retention function, seed data |
| `src/app/(app)/app/[org]/` | The admin app: dashboard, concerns, responses, campaigns, people, surveys, broadcasts, reports, settings |
| `src/app/r/[token]/` | The public survey form a respondent opens from their invitation |
| `src/app/k/[slug]/` | The standing QR / kiosk form for an organisation |
| `src/app/u/` | Unsubscribe links |
| `src/app/api/cron/` | Scheduler endpoints (called every 15 minutes) |
| `src/app/api/webhooks/` | Delivery and reply callbacks from Resend and Twilio |
| `src/lib/scheduler.ts` | Campaign expansion, sending, reminders, idempotency and quiet hours |
| `src/lib/ai.ts` | Sentiment, themes and concern classification of free text |
| `src/lib/responses.ts` | Storing a response and raising concerns |
| `src/lib/send/` | Email (Resend), WhatsApp and SMS (Twilio) |
| `RUNBOOK.md` | How to deploy, configure and keep it running |
| `CONVENTIONS.md` | Code conventions for anyone changing it |

## Running it locally

```bash
cp .env.example .env.local   # fill in the Supabase keys at least
npm install
npm run dev                  # http://localhost:3000
```

Sign in with the owner email set in `app_settings.owner_email` (see the migration). The sign-in link arrives by email from Supabase Auth.

## Deploying

See `RUNBOOK.md`. In short: Supabase project (apply the migrations), Netlify site connected to this repo (set the environment variables), Resend domain per organisation, Twilio numbers, and the pg_cron job that calls `/api/cron/tick`.
