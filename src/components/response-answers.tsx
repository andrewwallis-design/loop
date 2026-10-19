import type { Response, TemplateQuestion } from "@/lib/types";
import { formatAnswer, SentimentBadge } from "@/components/feedback-ui";

/** All answers to a response, listed with their prompts, plus free text and the AI read-out. */
export function ResponseAnswers({ response, questions }: { response: Response; questions: TemplateQuestion[] }) {
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const nonText = ordered.filter((q) => q.kind !== "text");
  const knownKeys = new Set(ordered.map((q) => q.key));
  const extra = Object.entries(response.answers ?? {}).filter(([k]) => !knownKeys.has(k));

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="text-lg font-semibold">Answers</h2>
        <dl className="mt-3 divide-y divide-stone-100">
          {nonText.map((q) => (
            <div key={q.id} className="flex items-start justify-between gap-4 py-2 text-sm">
              <dt className="text-stone-700">{q.prompt}</dt>
              <dd className="shrink-0 font-medium tabular-nums">{formatAnswer(q.kind, response.answers?.[q.key], q.options)}</dd>
            </div>
          ))}
          {extra.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-2 text-sm">
              <dt className="text-stone-500">{k}</dt>
              <dd className="shrink-0 font-medium">{String(v)}</dd>
            </div>
          ))}
          {nonText.length === 0 && extra.length === 0 && <p className="py-2 text-sm text-stone-500">No scored questions.</p>}
        </dl>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">In their words</h2>
          <SentimentBadge sentiment={response.sentiment} />
        </div>
        {response.free_text ? (
          <blockquote className="mt-3 whitespace-pre-wrap border-l-4 border-stone-200 pl-4 text-base text-stone-800">{response.free_text}</blockquote>
        ) : (
          <p className="mt-2 text-sm text-stone-500">No comment left.</p>
        )}
        {response.themes && response.themes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {response.themes.map((t) => (
              <span key={t} className="badge bg-stone-100 text-stone-700">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
