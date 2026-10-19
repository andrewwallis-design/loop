"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logAccess, requireOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { str } from "@/lib/format";

export async function takeOwnership(slug: string, concernId: string): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const supabase = await createClient();
  const { error } = await supabase
    .from("concerns")
    .update({ owner_user_id: access.session.userId, status: "in_progress" })
    .eq("id", concernId)
    .eq("organisation_id", access.org.id)
    .neq("status", "closed");
  if (error) redirect(`/app/${slug}/concerns/${concernId}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "own_concern", "concern", concernId);
  revalidatePath(`/app/${slug}/concerns`);
  revalidatePath(`/app/${slug}/concerns/${concernId}`);
  redirect(`/app/${slug}/concerns/${concernId}?ok=${encodeURIComponent("You now own this concern.")}`);
}

export async function closeConcern(slug: string, concernId: string, form: FormData): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const note = str(form, "closure_note");
  if (!note || note.length < 10) {
    redirect(`/app/${slug}/concerns/${concernId}?error=${encodeURIComponent("Write a closure note saying what was done (at least a sentence).")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("concerns")
    .update({
      status: "closed",
      closed_by: access.session.userId,
      closed_at: new Date().toISOString(),
      closure_note: note,
    })
    .eq("id", concernId)
    .eq("organisation_id", access.org.id)
    .neq("status", "closed");
  if (error) redirect(`/app/${slug}/concerns/${concernId}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "close_concern", "concern", concernId);
  revalidatePath(`/app/${slug}/concerns`);
  revalidatePath(`/app/${slug}/concerns/${concernId}`);
  revalidatePath(`/app/${slug}`);
  redirect(`/app/${slug}/concerns/${concernId}?ok=${encodeURIComponent("Concern closed.")}`);
}

export async function reopenConcern(slug: string, concernId: string): Promise<void> {
  const access = await requireOrg(slug, "manager");
  const supabase = await createClient();
  const { error } = await supabase
    .from("concerns")
    .update({ status: "in_progress", closed_by: null, closed_at: null, owner_user_id: access.session.userId })
    .eq("id", concernId)
    .eq("organisation_id", access.org.id)
    .eq("status", "closed");
  if (error) redirect(`/app/${slug}/concerns/${concernId}?error=${encodeURIComponent(error.message)}`);
  await logAccess(access, "reopen_concern", "concern", concernId);
  revalidatePath(`/app/${slug}/concerns`);
  revalidatePath(`/app/${slug}/concerns/${concernId}`);
  redirect(`/app/${slug}/concerns/${concernId}?ok=${encodeURIComponent("Concern reopened.")}`);
}
