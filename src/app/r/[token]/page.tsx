import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSurveyBundle } from "@/lib/responses";
import { SurveyForm } from "@/components/survey-form";
import { submitInvitationResponse } from "./actions";
import { PublicShell } from "@/components/public-shell";
import type { AnswerValue } from "@/lib/types";

export const metadata: Metadata = { title: "Your feedback", robots: { index: false } };

export default async function ResponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const { token } = await params;
  const { a } = await searchParams;
  const admin = createAdminClient();

  const { data: invitation } = await admin
    .from("invitations")
    .select("id, status, template_id, opened_at, respondent_id")
    .eq("token", token)
    .maybeSingle();

  if (!invitation || invitation.status === "cancelled") {
    return (
      <PublicShell title="Feedback">
        <h1 className="text-2xl font-semibold">This link isn’t available</h1>
        <p className="mt-2 text-stone-700">It may have expired or already been used. If you’d still like to give feedback, please contact the office.</p>
      </PublicShell>
    );
  }

  const bundle = await loadSurveyBundle(invitation.template_id);
  if (!bundle) {
    return (
      <PublicShell title="Feedback">
        <h1 className="text-2xl font-semibold">This survey is no longer available</h1>
      </PublicShell>
    );
  }

  if (invitation.status === "answered") {
    return (
      <PublicShell title={bundle.org.name} logoUrl={bundle.org.logo_url} brandColour={bundle.org.brand_colour}>
        <h1 className="text-2xl font-semibold">Thank you</h1>
        <p className="mt-2 text-lg text-stone-700">You’ve already sent us your feedback for this one.</p>
      </PublicShell>
    );
  }

  if (!invitation.opened_at) {
    await admin
      .from("invitations")
      .update({ opened_at: new Date().toISOString(), status: "opened" })
      .eq("id", invitation.id)
      .in("status", ["sent", "delivered"]);
  }

  // One-tap prefill from the email/WhatsApp message: ?a=4 fills the first question
  const prefill: Record<string, AnswerValue> = {};
  const first = bundle.questions[0];
  if (a && first && (first.kind === "rating5" || first.kind === "nps")) {
    const n = Number(a);
    const max = first.kind === "rating5" ? 5 : 10;
    const min = first.kind === "rating5" ? 1 : 0;
    if (Number.isInteger(n) && n >= min && n <= max) prefill[first.key] = n;
  }

  const action = submitInvitationResponse.bind(null, token);

  return (
    <PublicShell title={bundle.org.name} logoUrl={bundle.org.logo_url} brandColour={bundle.org.brand_colour}>
      <SurveyForm
        orgName={bundle.org.short_name ?? bundle.org.name}
        brandColour={bundle.org.brand_colour}
        template={bundle.template}
        questions={bundle.questions}
        prefill={prefill}
        onSubmit={action}
      />
    </PublicShell>
  );
}
