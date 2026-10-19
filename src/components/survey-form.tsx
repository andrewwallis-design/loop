"use client";

import { useState, useTransition } from "react";
import type { AnswerValue, Template, TemplateQuestion } from "@/lib/types";

export interface SurveySubmission {
  contactable: boolean;
  contactRequested: boolean;
  answers: Record<string, AnswerValue>;
}

export function SurveyForm({
  orgName,
  brandColour,
  template,
  questions,
  prefill,
  allowContactRequest = true,
  onSubmit,
}: {
  orgName: string;
  brandColour: string;
  template: Template;
  questions: TemplateQuestion[];
  prefill?: Record<string, AnswerValue>;
  allowContactRequest?: boolean;
  onSubmit: (s: SurveySubmission) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(prefill ?? {});
  const [contactable, setContactable] = useState<boolean | null>(template.anonymity_choice ? null : true);
  const [contactRequested, setContactRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function set(key: string, value: AnswerValue) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (template.anonymity_choice && contactable === null) {
      setError("Please choose whether you would like to stay anonymous.");
      return;
    }
    for (const q of questions) {
      const v = answers[q.key];
      if (q.required && (v === undefined || v === null || v === "")) {
        setError(`Please answer: ${q.prompt}`);
        return;
      }
    }
    startTransition(async () => {
      const result = await onSubmit({
        contactable: contactable ?? false,
        contactRequested: (contactable ?? false) && contactRequested,
        answers,
      });
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white" style={{ background: brandColour }}>✓</div>
        <h1 className="text-2xl font-semibold">Thank you</h1>
        <p className="mt-2 text-lg text-stone-700">{template.thank_you}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {template.intro && <p className="text-lg text-stone-700">{template.intro}</p>}

      {template.anonymity_choice && (
        <fieldset className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <legend className="px-1 text-base font-medium">Your name</legend>
          <p className="mb-3 text-sm text-stone-600">
            You can answer without telling us who you are. If you are happy for us to get in touch about what you say, choose the second option.
          </p>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white">
              <input type="radio" name="anon" className="mt-1" checked={contactable === false} onChange={() => setContactable(false)} />
              <span className="text-base">Keep me anonymous</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white">
              <input type="radio" name="anon" className="mt-1" checked={contactable === true} onChange={() => setContactable(true)} />
              <span className="text-base">I’m happy to be contacted about this</span>
            </label>
          </div>
          {template.non_performance_statement && (
            <p className="mt-3 text-sm text-stone-600">
              Nothing you say here will be used in a performance conversation unless we have a legal duty to act on it.
            </p>
          )}
        </fieldset>
      )}

      {questions.map((q, i) => (
        <Question key={q.id} index={i + 1} q={q} value={answers[q.key] ?? null} onChange={(v) => set(q.key, v)} brand={brandColour} />
      ))}

      {contactable && allowContactRequest && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-4">
          <input type="checkbox" className="mt-1" checked={contactRequested} onChange={(e) => setContactRequested(e.target.checked)} />
          <span className="text-base">I’d like someone from {orgName} to contact me about this</span>
        </label>
      )}

      {error && <p className="rounded-lg bg-red-50 p-3 text-base text-red-800">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl px-5 py-4 text-lg font-semibold text-white shadow-sm disabled:opacity-60"
        style={{ background: brandColour }}
      >
        {pending ? "Sending…" : "Send my feedback"}
      </button>
    </form>
  );
}

function Question({
  index,
  q,
  value,
  onChange,
  brand,
}: {
  index: number;
  q: TemplateQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  brand: string;
}) {
  return (
    <div>
      <label className="mb-3 block text-lg font-medium leading-snug">
        <span className="mr-2 text-stone-400">{index}.</span>
        {q.prompt}
        {q.required && <span className="ml-1 text-red-600" aria-hidden>*</span>}
      </label>
      {q.kind === "rating5" && (
        <Scale min={1} max={5} value={value} onChange={onChange} brand={brand} lowLabel="Poor" highLabel="Excellent" />
      )}
      {q.kind === "nps" && (
        <Scale min={0} max={10} value={value} onChange={onChange} brand={brand} lowLabel="Not at all likely" highLabel="Extremely likely" />
      )}
      {q.kind === "yesno" && (
        <div className="flex gap-3">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              onClick={() => onChange(b)}
              className="flex-1 rounded-xl border-2 px-4 py-3 text-lg"
              style={value === b ? { borderColor: brand, background: brand, color: "white" } : { borderColor: "#d6d3d1" }}
            >
              {b ? "Yes" : "No"}
            </button>
          ))}
        </div>
      )}
      {q.kind === "choice" && (
        <div className="space-y-2">
          {(q.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className="block w-full rounded-xl border-2 px-4 py-3 text-left text-base"
              style={value === opt ? { borderColor: brand, background: brand, color: "white" } : { borderColor: "#d6d3d1" }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {q.kind === "text" && (
        <textarea
          className="input min-h-32 text-base"
          maxLength={4000}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function Scale({
  min,
  max,
  value,
  onChange,
  brand,
  lowLabel,
  highLabel,
}: {
  min: number;
  max: number;
  value: AnswerValue;
  onChange: (v: number) => void;
  brand: string;
  lowLabel: string;
  highLabel: string;
}) {
  const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const big = nums.length <= 5;
  return (
    <div>
      <div className={big ? "grid grid-cols-5 gap-2" : "grid grid-cols-6 gap-1.5 sm:grid-cols-11"}>
        {nums.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(n)}
              className={(big ? "py-4 text-xl " : "py-3 text-base ") + "rounded-xl border-2 font-semibold"}
              style={selected ? { borderColor: brand, background: brand, color: "white" } : { borderColor: "#d6d3d1", background: "white" }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-sm text-stone-500">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
