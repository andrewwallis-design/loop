"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAccess, requireOrg } from "@/lib/auth";
import { slugify, str } from "@/lib/format";

/** App owner only: creates a new organisation (tenant) and opens its settings. */
export async function createOrganisation(currentSlug: string, form: FormData): Promise<void> {
  const access = await requireOrg(currentSlug, "viewer");
  const back = `/app/${currentSlug}/settings/organisations/new`;
  if (!access.session.profile.is_owner) redirect(`/app/${currentSlug}`);
  const fail = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const name = str(form, "name");
  if (!name) fail("The organisation needs a name.");
  let slug = slugify(str(form, "slug") ?? name!, 40);
  if (!slug || slug.length < 2) fail("The short link name needs at least two letters or numbers.");
  if (["app", "k", "r", "api", "auth", "login", "new"].includes(slug)) fail("That short link name is reserved.");

  const brand_colour = (str(form, "brand_colour") ?? "#1f5f8b").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(brand_colour)) fail("Brand colour must be a hex colour such as #1f5f8b.");
  const respondent_noun = (str(form, "respondent_noun") ?? "client").toLowerCase();

  const supabase = await createClient();
  const { data: clash } = await supabase.from("organisations").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await supabase
    .from("organisations")
    .insert({
      name,
      slug,
      short_name: str(form, "short_name"),
      respondent_noun,
      brand_colour,
      from_name: str(form, "short_name") ?? name,
      concern_owner_user_id: access.session.userId,
    })
    .select("id, slug")
    .single();
  if (error || !data) fail(error?.message ?? "Could not create the organisation.");

  // The app owner sees every organisation already; the membership row records the role explicitly
  await supabase.from("memberships").upsert(
    { organisation_id: data!.id, user_id: access.session.userId, role: "owner" },
    { onConflict: "organisation_id,user_id" },
  );

  await logAccess(access, "create_organisation", "organisation", data!.id, { slug: data!.slug });
  revalidatePath("/app", "layout");
  redirect(`/app/${data!.slug}/settings?ok=${encodeURIComponent(`${name} created. Fill in the sending details and add a survey.`)}`);
}
