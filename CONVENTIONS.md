# Loop — code conventions (read before adding code)

Loop is a multi-tenant feedback app: organisations → respondents → campaigns → invitations → responses → concerns, plus broadcasts (information out). The spec lives in the Claude doc "Loop — Feedback App Specification"; the schema is `supabase/migrations/0001_init.sql` (read it — column names matter).

## Stack
- Next.js 16 App Router, TypeScript, Tailwind v4. `cacheComponents` is OFF; every page is dynamic.
- `params` and `searchParams` are Promises: `const { org } = await params;`
- Supabase: `@/lib/supabase/server` (user-scoped, RLS) for admin pages; `@/lib/supabase/admin` (service role) ONLY in server code for public forms, scheduler, webhooks, and where RLS would block a legitimate server-side write (e.g. creating invitations in bulk). Never import admin into a client component.
- Auth helpers in `@/lib/auth`: `requireOrg(slug, minRole)` returns `{ org, role, session, canSeeIdentity }`; `logAccess(access, action, entity?, id?, detail?)` writes the audit log. Roles: viewer < staff < manager < owner. Managers and owners can see who said what; staff and viewers only see anonymised responses.
- Types in `@/lib/types` (`Organisation`, `Respondent`, `Template`, `TemplateQuestion`, `Campaign`, `Invitation`, `Response`, `Concern`, `Broadcast`, label maps).
- Sending in `@/lib/send`: `sendEmail(org, {to, subject, html, text})`, `sendWhatsApp(org, {to, body, contentSid?, contentVariables?})`, `sendSms(org, {to, body})`, `merge(template, vars)`, `appUrl(path)`.
- Responses in `@/lib/responses`: `loadSurveyBundle(templateId)`, `validateAnswers`, `recordResponse(input)` (also raises immediate concerns), `raiseConcern(org, responseId, reason, summary)`.

## Routing
- Admin pages live under `src/app/(app)/app/[org]/<section>/page.tsx`. The org layout already renders nav + org switcher. Nav sections: `` (dashboard), `/concerns`, `/responses`, `/campaigns`, `/respondents`, `/templates`, `/broadcasts`, `/reports`, `/settings`.
- Mutations are server actions in an `actions.ts` next to the page (`"use server"`), each starting with `requireOrg(slug, 'manager' | 'staff')` and ending with `revalidatePath`. Return `{ ok: true } | { ok: false; error: string }` or `redirect()`.
- Public pages: `/r/[token]` (invitation form), `/k/[slug]` (kiosk). Don't change them.
- Webhooks and cron under `src/app/api/...` use the admin client and verify a secret.

## UI
- Server components by default; small client components only where state is needed. Keep styling to Tailwind utility classes plus the shared classes in `globals.css`: `.card`, `.input`, `.label`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.badge`.
- Page pattern: `<h1 className="text-2xl font-semibold">Title</h1>` + short grey description, then cards/tables. Tables: `<table className="w-full text-sm">` with `th` left-aligned, `tr` with `border-t border-stone-100`.
- British English, plain words, no emoji. Dates as `19 Oct 2026` (use `new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })`).
- Phone numbers stored E.164 (`+44…`); a helper `toE164(uk string)` belongs in `@/lib/phone` (create it if you need it: strip spaces, `07…` → `+447…`).

## Rules the code must enforce
- Respondents are scoped per organisation; every query filters by `organisation_id`.
- No invitations to anyone with `relationship_end` set, `unsubscribed_at` set, or `consent_feedback = false`; WhatsApp only where `whatsapp_opt_in`; broadcasts with `is_marketing` only where `consent_news`.
- Full survey (non-pulse) at most once per respondent per `campaign.min_days_between_surveys` days; a pulse and a full survey never within 30 days of each other.
- Sends are idempotent: one invitation per (campaign, respondent) — the unique constraint enforces it; the scheduler must claim rows before sending (update status to a transient state or use `sent_at is null` guards) so a retry can't double-send.
- SMS/WhatsApp are not sent between `org.quiet_hours_start` and `org.quiet_hours_end` (UK time, Europe/London); email can go any time.
- Any view of an identifiable response by a manager is logged with `logAccess(..., "view_response", "response", id)`.

## Finishing
- Run `npx tsc --noEmit -p .` and fix all errors in files you wrote. Don't edit files outside your assignment except to add an export you need (say so in your report).
