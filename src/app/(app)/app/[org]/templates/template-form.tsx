import { RESPONDENT_TYPE_LABEL, type RespondentType, type Template } from "@/lib/types";
import { QuestionEditor } from "./question-editor";
import type { EditorQuestion } from "./actions";

/** Server-rendered form body shared by /templates/new and /templates/[id]/edit. */
export function TemplateFormFields({ template, questions }: { template?: Template | null; questions: EditorQuestion[] }) {
  const t = template;
  return (
    <>
      <div className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" required defaultValue={t?.name ?? ""} placeholder="Client and family feedback" />
          </div>
          <div>
            <label className="label" htmlFor="audience">Who it is for</label>
            <select id="audience" name="audience" className="input" defaultValue={t?.audience ?? "client"}>
              {(Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[]).map((k) => (
                <option key={k} value={k}>{RESPONDENT_TYPE_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_pulse" defaultChecked={t?.is_pulse ?? false} />
              Pulse (one or two quick questions after an event)
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="intro">Introduction <span className="font-normal text-stone-500">(shown at the top)</span></label>
            <textarea id="intro" name="intro" className="input min-h-20" defaultValue={t?.intro ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="thank_you">Thank-you message</label>
            <input id="thank_you" name="thank_you" className="input" defaultValue={t?.thank_you ?? "Thank you. Your feedback has been received."} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="anonymity_choice" defaultChecked={t?.anonymity_choice ?? true} />
              Let people choose whether to stay anonymous
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="non_performance_statement" defaultChecked={t?.non_performance_statement ?? false} />
              Show the non-performance statement (for carer and staff surveys)
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-base font-semibold">Questions</h2>
        <QuestionEditor initial={questions} />
      </div>
    </>
  );
}
