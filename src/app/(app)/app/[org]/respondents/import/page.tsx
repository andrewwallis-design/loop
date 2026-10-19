import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { CsvImporter } from "./csv-importer";

export default async function ImportPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const access = await requireOrg(slug, "staff");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/app/${slug}/respondents`} className="text-sm text-stone-500 hover:underline">← People</Link>
        <h1 className="mt-1 text-2xl font-semibold">Import people from a CSV</h1>
        <p className="mt-1 text-sm text-stone-600">
          Export from Access Care Planner, a booking system or a spreadsheet, then match the columns.
          Existing people are matched by email or mobile and updated rather than duplicated.
        </p>
      </div>
      <CsvImporter slug={slug} defaultType={access.org.respondent_noun === "pilot" ? "pilot" : access.org.respondent_noun === "patient" ? "patient" : "client"} />
    </div>
  );
}
