"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SurveyForm, type SurveySubmission } from "@/components/survey-form";
import type { Template, TemplateQuestion } from "@/lib/types";
import { recordManualResponse, type ManualSource } from "./actions";

export interface RespondentOption {
  id: string;
  label: string;
}

export function ManualEntry({
  slug,
  orgName,
  brandColour,
  templates,
  questions,
  respondents,
}: {
  slug: string;
  orgName: string;
  brandColour: string;
  templates: Template[];
  questions: TemplateQuestion[];
  respondents: RespondentOption[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [respondentId, setRespondentId] = useState("");
  const [source, setSource] = useState<ManualSource>("staff_entered");
  const [search, setSearch] = useState("");
  const [formKey, setFormKey] = useState(0);

  const template = templates.find((t) => t.id === templateId);
  const templateQuestions = useMemo(
    () => questions.filter((q) => q.template_id === templateId).sort((a, b) => a.position - b.position),
    [questions, templateId],
  );
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? respondents.filter((r) => r.label.toLowerCase().includes(s)) : respondents;
  }, [respondents, search]);

  // Staff fill the form on the person's behalf, so the anonymity question is not asked here.
  const formTemplate = template ? { ...template, anonymity_choice: false, intro: null } : null;

  async function submit(s: SurveySubmission) {
    const result = await recordManualResponse(slug, { templateId, respondentId: respondentId || null, source }, s);
    if (result.ok) {
      router.push(`/app/${slug}/responses`);
      router.refresh();
    }
    return result;
  }

  return (
    <div className="space-y-6">
      <div className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="template">Survey</label>
          <select
            id="template"
            className="input"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setFormKey((k) => k + 1);
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="source">How it reached us</label>
          <select id="source" className="input" value={source} onChange={(e) => setSource(e.target.value as ManualSource)}>
            <option value="staff_entered">Telephone or in person (staff-entered)</option>
            <option value="letter">Paper form or letter</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="search">Who gave the feedback (optional)</label>
          <input
            id="search"
            className="input mb-2"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select id="respondent" className="input" value={respondentId} onChange={(e) => setRespondentId(e.target.value)}>
            <option value="">Anonymous — do not link to a person</option>
            {filtered.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Only link a person when they have said they are happy to be identified. Linked responses are visible to managers only.
          </p>
        </div>
      </div>

      {formTemplate ? (
        <div className="card">
          <SurveyForm
            key={`${templateId}-${formKey}`}
            orgName={orgName}
            brandColour={brandColour}
            template={formTemplate}
            questions={templateQuestions}
            allowContactRequest={!!respondentId}
            onSubmit={submit}
          />
        </div>
      ) : (
        <p className="text-sm text-stone-500">No current surveys. Create one under Surveys first.</p>
      )}
    </div>
  );
}
