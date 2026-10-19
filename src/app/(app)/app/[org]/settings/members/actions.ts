"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAccess, requireOrg } from "@/lib/auth";
import { appUrl } from "@/lib/send";
import { str } from "@/lib/format";
import { ROLE_RANK, type MemberRole } from "@/lib/types";

const ROLES = Object.keys(ROLE_RANK) as MemberRole[];

/**
 * Invites a user by email (Supabase sends the magic link), makes sure a profile row exists,
 * and adds the membership. If the email is already a user, the membership is added or updated.
 */
export async function inviteMember(slug: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const back = `/app/${slug}/settings/members`;
  const fail = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const email = (str(form, "email") ?? "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.");
  const roleRaw = str(form, "role");
  const role: MemberRole = ROLES.includes(roleRaw as MemberRole) ? (roleRaw as MemberRole) : "staff";
  // Only an owner may grant owner; a manager can grant up to manager
  if (ROLE_RANK[role] > ROLE_RANK[access.role]) fail(`You cannot grant a role above your own (${access.role}).`);
  const expiresRaw = str(form, "expires_at");
  let expires_at: string | null = null;
  if (expiresRaw) {
    const d = new Date(`${expiresRaw}T23:59:59`);
    if (Number.isNaN(d.getTime())) fail("The expiry date could not be read.");
    if (d.getTime() < Date.now()) fail("The expiry date is in the past.");
    expires_at = d.toISOString();
  }

  const admin = createAdminClient();
  let userId: string | null = null;
  let notice = "";

  // Existing profile?
  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) {
    userId = existing.id;
    notice = `${email} already has a login; membership updated.`;
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: appUrl("/auth/callback"),
      data: { invited_to: access.org.slug },
    });
    if (inviteError || !invited?.user) {
      // Commonly: user already registered via another route, or SMTP not configured.
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const match = list?.users.find((u) => u.email?.toLowerCase() === email);
      if (!match) fail(`Could not invite ${email}: ${inviteError?.message ?? "unknown error"}. Check the auth email settings in Supabase.`);
      userId = match!.id;
      notice = `${email} already had an account; membership added. They can sign in with a magic link from the login page.`;
    } else {
      userId = invited.user.id;
      notice = `Invitation sent to ${email}.`;
    }
    // The DB trigger creates the profile on auth.users insert; make sure it is there.
    const { data: profile } = await admin.from("profiles").select("id").eq("id", userId!).maybeSingle();
    if (!profile) {
      await admin.from("profiles").upsert({ id: userId!, email, full_name: email.split("@")[0], is_owner: false });
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .upsert({ organisation_id: access.org.id, user_id: userId!, role, expires_at }, { onConflict: "organisation_id,user_id" });
  if (error) fail(error.message);

  await logAccess(access, "invite_member", "membership", undefined, { email, role, expires_at });
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(notice)}`);
}

export async function updateMemberRole(slug: string, membershipId: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const back = `/app/${slug}/settings/members`;
  const roleRaw = str(form, "role");
  const role: MemberRole = ROLES.includes(roleRaw as MemberRole) ? (roleRaw as MemberRole) : "staff";
  if (ROLE_RANK[role] > ROLE_RANK[access.role]) redirect(`${back}?error=${encodeURIComponent("You cannot grant a role above your own.")}`);
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").update({ role }).eq("id", membershipId).eq("organisation_id", access.org.id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "update_member_role", "membership", membershipId, { role });
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Role updated.")}`);
}

export async function removeMember(slug: string, membershipId: string): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const back = `/app/${slug}/settings/members`;
  const supabase = await createClient();
  const { data: m } = await supabase.from("memberships").select("user_id").eq("id", membershipId).eq("organisation_id", access.org.id).maybeSingle();
  if (!m) redirect(`${back}?error=${encodeURIComponent("Membership not found.")}`);
  if (m!.user_id === access.session.userId && !access.session.profile.is_owner) {
    redirect(`${back}?error=${encodeURIComponent("You cannot remove your own access.")}`);
  }
  const { error } = await supabase.from("memberships").delete().eq("id", membershipId).eq("organisation_id", access.org.id);
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "remove_member", "membership", membershipId);
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Member removed.")}`);
}
