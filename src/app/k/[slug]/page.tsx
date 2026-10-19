import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSurveyBundle } from "@/lib/responses";
import { SurveyForm } from "@/components/survey-form";
import { PublicShell } from "@/components/public-shell";
import { submitKioskResponse } from "./actions";

export const metadata: Metadata = { title: "Your feedback", robots: { index: false } };

/** Standing QR / kiosk link: /k/<organisation slug> */
export default async function KioskPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: org } = await admin.from("organisations").select("id, kiosk_template_id").eq("slug", slug).maybeSingle();
  const bundle = org?.kiosk_template_id ? await loadSurveyBundle(org.kiosk_template_id) : null;
  if (!bundle) {
    return (
      <PublicShell title="Feedback">
        <h1 className="text-2xl font-semibold">Feedback isn’t open here yet</h1>
      </PublicShell>
    );
  }
  const action = submitKioskResponse.bind(null, slug);
  return (
    <PublicShell title={bundle.org.name} logoUrl={bundle.org.logo_url} brandColour={bundle.org.brand_colour}>
      <SurveyForm
        orgName={bundle.org.short_name ?? bundle.org.name}
        brandColour={bundle.org.brand_colour}
        template={{ ...bundle.template, anonymity_choice: false, intro: bundle.template.intro ?? "Your answers are anonymous. If you would like us to contact you, add your name and number in the comments." }}
        questions={bundle.questions}
        allowContactRequest={false}
        onSubmit={action}
      />
    </PublicShell>
  );
}
