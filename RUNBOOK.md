# Loop — runbook

One page on how Loop is deployed and kept running. Keep it current.

## The pieces

| Piece | Service | Account | What it does |
| --- | --- | --- | --- |
| Code | GitHub, private repo `loop` | Andrew | The master copy. Every push to `main` deploys. |
| Web app | Netlify | Andrew | Serves the admin app and the public forms |
| Database and sign-in | Supabase, project `loop` (EU/UK region) | Andrew | All data, user accounts, scheduled jobs |
| Email | Resend | Andrew | Sends invitations, reminders, broadcasts, concern alerts |
| WhatsApp and SMS | Twilio (existing account) | Andrew | One number per organisation |
| AI classification | Anthropic API | Andrew | Reads free-text comments for sentiment, themes and concerns |

Monthly cost: Supabase ~£20, Netlify free tier, Resend free tier, Twilio ~£1 per number plus message traffic, Anthropic a few pounds.

## First-time setup

### 1. Supabase
1. Create a project called `loop` in the London (or Frankfurt) region.
2. SQL editor → paste and run `supabase/migrations/0001_init.sql`, then `0002_cron.sql`.
3. Authentication → Providers → Email: enable, turn **off** "Confirm email" is not needed (magic links handle it). Authentication → URL configuration: set Site URL to the Netlify URL and add `https://<netlify-url>/auth/callback` and `http://localhost:3000/auth/callback` to Redirect URLs.
4. Project settings → API: copy the URL, anon key and service role key for the environment variables.
5. Edit `app_settings.owner_email` if the owner's email differs from the seed.

### 2. Resend (email)
1. Add a domain per organisation — use a sending subdomain, e.g. `feedback.alcesterhomecareagency.co.uk`.
2. Add the three DNS records Resend shows (SPF, DKIM, DMARC) at the domain registrar. Wait for "Verified".
3. In Loop → Settings, set `from_email` to `feedback@feedback.<domain>` and `reply_to` to the office mailbox (e.g. `feedback@<domain>`).
4. Webhooks → add `https://<netlify-url>/api/webhooks/resend` for `email.delivered`, `email.bounced`, `email.complained`; copy the signing secret into `RESEND_WEBHOOK_SECRET`.

### 3. Twilio (WhatsApp and SMS)
1. Buy a UK number per organisation (Phone numbers → Buy). Set its messaging webhook to `https://<netlify-url>/api/webhooks/twilio` (HTTP POST).
2. WhatsApp: Messaging → Senders → WhatsApp senders → add the number and link it to the organisation's Meta Business Portfolio (business.facebook.com, verified with Companies House details). Submit message templates (invitation, reminder, service notice) for approval. Put the invitation template's Content SID in `WHATSAPP_INVITE_CONTENT_SID` once approved.
3. In Loop → Settings, set `whatsapp_number` and `sms_number` (E.164, `+44…`).

### 4. Netlify
1. New site → import from GitHub → `loop`. Build command `npm run build`, publish directory `.next` (the Next.js plugin handles the rest).
2. Site configuration → Environment variables: add every key from `.env.example` with the real values. `NEXT_PUBLIC_APP_URL` is the site's URL (custom domain if set).
3. Deploy. Visit `/login`, sign in as the owner.

### 5. Scheduler
`supabase/migrations/0002_cron.sql` sets up pg_cron to call `/api/cron/tick` every 15 minutes and `/api/cron/retention` nightly. After deploying, update the `private.app_config` row with the real app URL and the `CRON_SECRET` value (instructions are in the migration file). Check Supabase → Integrations → Cron shows the two jobs running.

### 6. Anthropic
Create an API key at console.anthropic.com and put it in `ANTHROPIC_API_KEY`. Without it, comments are stored but not classified; concerns from low ratings and "contact me" still fire.

## Everyday operations

- **Add an organisation:** org switcher → "Add an organisation". Then fill in Settings (sender email, numbers, concern owner and deputy, kiosk survey).
- **Add a user:** Settings → Members → invite by email with a role. Viewers can be given an expiry date (an inspector for the day).
- **Go live with a campaign:** create it, "Send test to my email", check it, then Activate. Ad hoc campaigns are sent from the campaign page with the respondent picker.
- **Concerns:** the owner and deputy get an email the moment one is raised. Open it, take ownership, deal with it, close it with a note. The closure notes form the audit trail in the compliance report.
- **Reports:** Reports → pick type and period → Print / Save as PDF.

## When something goes wrong

| Symptom | Check |
| --- | --- |
| Invitations stuck at "scheduled" | Supabase → Cron: is the tick job running? Is `private.app_config` correct? Call `/api/cron/tick` by hand with the bearer secret and read the JSON. |
| Emails not arriving | Resend → Emails: delivered or bounced? Domain still verified? Check spam. |
| WhatsApp failing | Twilio → Monitor → Logs → Messaging. Template not approved, number not registered, or respondent not opted in. |
| Sign-in link doesn't work | Supabase → Authentication → URL configuration: redirect URL must match the site. |
| Someone can't see an organisation | Settings → Members: are they a member with a role? Expired? |
| Deploy failed | Netlify → Deploys → log. Usually a missing environment variable. |

## Keys and secrets

Secrets live only in Netlify environment variables and in `.env.local` on the developer's machine. Never commit `.env.local`. To rotate a key: generate the new one in the provider, update Netlify, redeploy, then revoke the old one.

## Backups

Supabase takes daily backups on paid plans (Settings → Database → Backups). The code is on GitHub. Nothing else holds data.
