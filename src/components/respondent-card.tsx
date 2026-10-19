import Link from "next/link";
import { formatPhone } from "@/lib/phone";
import { RESPONDENT_TYPE_LABEL, type Respondent } from "@/lib/types";

/** Identity card shown to managers for a contactable response. Callers must logAccess first. */
export function RespondentCard({
  slug,
  person,
  title = "Who said this",
}: {
  slug: string;
  person: Pick<Respondent, "id" | "full_name" | "email" | "mobile" | "type" | "relates_to" | "relationship_end">;
  title?: string;
}) {
  return (
    <div className="card border-brand/30">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{title}</div>
      <div className="mt-1 text-lg font-semibold">
        <Link href={`/app/${slug}/respondents/${person.id}`} className="hover:underline">{person.full_name}</Link>
      </div>
      <div className="mt-1 text-sm text-stone-600">
        {RESPONDENT_TYPE_LABEL[person.type]}
        {person.relates_to && <> · next of kin to {person.relates_to}</>}
        {person.relationship_end && <> · no longer with us</>}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-stone-500">Email</dt>
          <dd>{person.email ? <a href={`mailto:${person.email}`} className="text-brand hover:underline">{person.email}</a> : "—"}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Mobile</dt>
          <dd>{person.mobile ? <a href={`tel:${person.mobile}`} className="text-brand hover:underline">{formatPhone(person.mobile)}</a> : "—"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-stone-500">This view has been recorded in the access log.</p>
    </div>
  );
}
