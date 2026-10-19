import Link from "next/link";
import QRCode from "qrcode";
import { requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/send";
import { formatPhone } from "@/lib/phone";
import type { Profile, Template } from "@/lib/types";
import { Flash } from "@/components/flash";
import { updateOrganisation } from "./actions";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "manager");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const org = access.org;

  const [{ data: tpls }, { data: mems }] = await Promise.all([
    supabase.from("templates").select("id, name, is_pulse").eq("organisation_id", org.id).eq("is_current", true).order("name"),
    supabase.from("memberships").select("user_id, role, profiles(id, email, full_name)").eq("organisation_id", org.id),
  ]);
  const templates = (tpls ?? []) as Pick<Template, "id" | "name" | "is_pulse">[];
  const members = ((mems ?? []) as unknown as Array<{ user_id: string; role: string; profiles: Pick<Profile, "id" | "email" | "full_name"> | null }>)
    .map((m) => m.profiles)
    .filter((p): p is Pick<Profile, "id" | "email" | "full_name"> => !!p)
    .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));
  // The app owner can be the concern owner even without a membership row
  if (!members.some((m) => m.id === access.session.userId)) {
    members.unshift({ id: access.session.userId, email: access.session.profile.email, full_name: access.session.profile.full_name });
  }

  const kioskLink = appUrl(`/k/${org.slug}`);
  const qrSvg = await QRCode.toString(kioskLink, { type: "svg", margin: 1, width: 160, color: { dark: "#1c1c1a", light: "#ffffff" } });
  const action = updateOrganisation.bind(null, slug);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-stone-600">How {org.name} appears to the people you contact, and how the app behaves.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/app/${slug}/settings/members`} className="btn-secondary">Team members</Link>
          {access.session.profile.is_owner && <Link href={`/app/${slug}/settings/organisations/new`} className="btn-secondary">New organisation</Link>}
        </div>
      </div>

      <Flash ok={ok} error={error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <form action={action} className="space-y-6 lg:col-span-2">
          <section className="card space-y-4">
            <h2 className="text-base font-semibold">Organisation</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="name">Name</label>
                <input id="name" name="name" className="input" required defaultValue={org.name} />
              </div>
              <div>
                <label className="label" htmlFor="short_name">Short name <span className="font-normal text-stone-500">(used in messages)</span></label>
                <input id="short_name" name="short_name" className="input" defaultValue={org.short_name ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="respondent_noun">What you call the people you serve</label>
                <select id="respondent_noun" name="respondent_noun" className="input" defaultValue={org.respondent_noun}>
                  <option value="client">Clients</option>
                  <option value="pilot">Pilots</option>
                  <option value="patient">Patients</option>
                  <option value="customer">Customers</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="brand_colour">Brand colour</label>
                <div className="flex items-center gap-3">
                  <input id="brand_colour" name="brand_colour" type="color" defaultValue={org.brand_colour} className="h-10 w-14 cursor-pointer rounded border border-stone-300 bg-white p-1" />
                  <span className="font-mono text-sm text-stone-600">{org.brand_colour}</span>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="logo_url">Logo URL</label>
                <input id="logo_url" name="logo_url" type="url" className="input" placeholder="https://…/logo.png" defaultValue={org.logo_url ?? ""} />
              </div>
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="text-base font-semibold">Sending</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="from_name">From name</label>
                <input id="from_name" name="from_name" className="input" defaultValue={org.from_name ?? ""} placeholder={org.name} />
              </div>
              <div>
                <label className="label" htmlFor="from_email">From email <span className="font-normal text-stone-500">(a verified sending domain)</span></label>
                <input id="from_email" name="from_email" type="email" className="input" defaultValue={org.from_email ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="reply_to">Reply-to email</label>
                <input id="reply_to" name="reply_to" type="email" className="input" defaultValue={org.reply_to ?? ""} />
              </div>
              <div />
              <div>
                <label className="label" htmlFor="whatsapp_number">WhatsApp number</label>
                <input id="whatsapp_number" name="whatsapp_number" className="input" defaultValue={formatPhone(org.whatsapp_number)} placeholder="+447700900000" />
              </div>
              <div>
                <label className="label" htmlFor="sms_number">SMS number</label>
                <input id="sms_number" name="sms_number" className="input" defaultValue={formatPhone(org.sms_number)} placeholder="+447700900000" />
              </div>
              <div>
                <label className="label" htmlFor="quiet_hours_start">Quiet hours start <span className="font-normal text-stone-500">(no texts after)</span></label>
                <input id="quiet_hours_start" name="quiet_hours_start" type="time" className="input" defaultValue={org.quiet_hours_start.slice(0, 5)} />
              </div>
              <div>
                <label className="label" htmlFor="quiet_hours_end">Quiet hours end</label>
                <input id="quiet_hours_end" name="quiet_hours_end" type="time" className="input" defaultValue={org.quiet_hours_end.slice(0, 5)} />
              </div>
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="text-base font-semibold">Concerns and kiosk</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="concern_owner_user_id">Concern owner <span className="font-normal text-stone-500">(alerted first)</span></label>
                <select id="concern_owner_user_id" name="concern_owner_user_id" className="input" defaultValue={org.concern_owner_user_id ?? ""}>
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="concern_deputy_user_id">Deputy</label>
                <select id="concern_deputy_user_id" name="concern_deputy_user_id" className="input" defaultValue={org.concern_deputy_user_id ?? ""}>
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="kiosk_template_id">Kiosk / QR survey</label>
                <select id="kiosk_template_id" name="kiosk_template_id" className="input" defaultValue={org.kiosk_template_id ?? ""}>
                  <option value="">None (kiosk link switched off)</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.is_pulse ? " (pulse)" : ""}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="text-base font-semibold">Retention</h2>
            <p className="text-sm text-stone-600">Run nightly. Responses are anonymised, not deleted, so trends survive.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="retention_responses_months">Responses: unlink after (months)</label>
                <input id="retention_responses_months" name="retention_responses_months" type="number" min={1} max={240} className="input" defaultValue={org.retention_responses_months} />
              </div>
              <div>
                <label className="label" htmlFor="retention_contacts_months">Contacts: delete after leaving (months)</label>
                <input id="retention_contacts_months" name="retention_contacts_months" type="number" min={1} max={240} className="input" defaultValue={org.retention_contacts_months} />
              </div>
              <div>
                <label className="label" htmlFor="retention_broadcast_log_months">Broadcast logs (months)</label>
                <input id="retention_broadcast_log_months" name="retention_broadcast_log_months" type="number" min={1} max={240} className="input" defaultValue={org.retention_broadcast_log_months} />
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <button className="btn-primary">Save settings</button>
          </div>
        </form>

        <aside className="space-y-6">
          <div className="card">
            <h2 className="text-base font-semibold">Kiosk link</h2>
            <p className="mt-1 text-sm text-stone-600">Print this for the office, reception or a leaflet. Anyone scanning it reaches the kiosk survey anonymously.</p>
            <div className="mt-3 flex justify-center rounded-lg border border-stone-200 bg-white p-3" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <a href={kioskLink} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm text-brand underline">{kioskLink}</a>
            {!org.kiosk_template_id && <p className="mt-2 text-xs text-amber-700">Choose a kiosk survey on the left to switch this link on.</p>}
          </div>
          <div className="card text-sm text-stone-600">
            <h2 className="text-base font-semibold text-stone-900">Identifier</h2>
            <p className="mt-1">Slug <code className="rounded bg-stone-100 px-1">{org.slug}</code>. This is part of every link and cannot be changed.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
