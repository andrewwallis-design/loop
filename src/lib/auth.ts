import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_RANK, type MemberRole, type Organisation, type Profile } from "@/lib/types";

export interface Session {
  userId: string;
  profile: Profile;
}

/** The signed-in user's profile, or a redirect to /login. */
export async function requireSession(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_owner")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // First sign-in before the trigger has run (rare). Create a minimal profile.
    const admin = createAdminClient();
    const { data: settings } = await admin.from("app_settings").select("owner_email").single();
    const isOwner = settings?.owner_email?.toLowerCase() === user.email?.toLowerCase();
    await admin.from("profiles").upsert({ id: user.id, email: user.email, is_owner: isOwner });
    return {
      userId: user.id,
      profile: { id: user.id, email: user.email ?? "", full_name: null, is_owner: isOwner },
    };
  }
  return { userId: user.id, profile };
}

export interface OrgAccess {
  org: Organisation;
  role: MemberRole;
  session: Session;
  /** True when the user may see who said what. */
  canSeeIdentity: boolean;
}

/** Organisations the user can see, with their role in each. */
export async function listOrganisations(session: Session): Promise<Array<{ org: Organisation; role: MemberRole }>> {
  const supabase = await createClient();
  if (session.profile.is_owner) {
    const { data } = await supabase.from("organisations").select("*").order("name");
    return (data ?? []).map((org) => ({ org: org as Organisation, role: "owner" }));
  }
  const { data } = await supabase
    .from("memberships")
    .select("role, expires_at, organisations(*)")
    .eq("user_id", session.userId);
  return (data ?? [])
    .filter((m) => !m.expires_at || new Date(m.expires_at) > new Date())
    .map((m) => ({ org: m.organisations as unknown as Organisation, role: m.role as MemberRole }))
    .sort((a, b) => a.org.name.localeCompare(b.org.name));
}

/** Loads an organisation by slug and checks the user holds at least `minRole` in it. */
export async function requireOrg(slug: string, minRole: MemberRole = "viewer"): Promise<OrgAccess> {
  const session = await requireSession();
  const orgs = await listOrganisations(session);
  const match = orgs.find((o) => o.org.slug === slug);
  if (!match) redirect("/app");
  if (ROLE_RANK[match.role] < ROLE_RANK[minRole]) redirect(`/app/${slug}`);
  return {
    org: match.org,
    role: match.role,
    session,
    canSeeIdentity: ROLE_RANK[match.role] >= ROLE_RANK.manager,
  };
}

export function hasRole(role: MemberRole, minRole: MemberRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/** Records an auditable action (view of identifiable data, send, close, etc.). */
export async function logAccess(
  access: OrgAccess,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: Record<string, unknown>,
) {
  const supabase = await createClient();
  await supabase.from("access_log").insert({
    organisation_id: access.org.id,
    user_id: access.session.userId,
    action,
    entity: entity ?? null,
    entity_id: entityId ?? null,
    detail: detail ?? null,
  });
}
