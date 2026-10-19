"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { RESPONDENT_TYPE_LABEL, type RespondentType } from "@/lib/types";
import { IMPORT_FIELDS, IMPORT_FIELD_LABEL, type ImportField, type ImportResult, type ImportRow } from "../import-fields";
import { importRespondents } from "../actions";

type Mapping = Partial<Record<ImportField, string>>;

/** Guesses a column for each field from common header names. */
function guessMapping(headers: string[]): Mapping {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (...candidates: string[]) => headers.find((h) => candidates.includes(norm(h)));
  const m: Mapping = {};
  m.full_name = find("fullname", "name", "clientname", "client", "patientname", "pilotname", "contactname");
  m.email = find("email", "emailaddress", "emailaddress1", "e-mail");
  m.mobile = find("mobile", "mobilenumber", "mobilephone", "phone", "telephone", "tel", "cell");
  m.type = find("type", "respondenttype", "role", "category");
  m.relates_to = find("relatesto", "nextofkinto", "client", "clientname", "relatedto");
  m.external_ref = find("ref", "reference", "externalref", "id", "clientid", "bookingref");
  m.relationship_start = find("relationshipstart", "startdate", "start", "carestart", "joined", "joindate");
  m.event_date = find("eventdate", "event", "medicaldate", "appointmentdate", "appointment", "treatmentdate", "visitdate");
  // Do not let two fields share a column by default (e.g. "client" for both name and relates_to)
  const used = new Set<string>();
  for (const f of IMPORT_FIELDS) {
    const col = m[f];
    if (!col) continue;
    if (used.has(col)) delete m[f];
    else used.add(col);
  }
  return m;
}

function storageKey(slug: string) {
  return `loop:import-mapping:${slug}`;
}

export function CsvImporter({ slug, defaultType: initialType }: { slug: string; defaultType: RespondentType }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaultType, setDefaultType] = useState<RespondentType>(initialType);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  /** Applies the mapping remembered for this organisation in this browser, falling back to header guesses. */
  function applySavedOrGuessedMapping(hs: string[]) {
    let saved: Mapping | null = null;
    try {
      const raw = localStorage.getItem(storageKey(slug));
      if (raw) {
        const parsed = JSON.parse(raw) as { mapping?: Mapping; defaultType?: RespondentType };
        saved = parsed.mapping ?? null;
        if (parsed.defaultType && parsed.defaultType in RESPONDENT_TYPE_LABEL) setDefaultType(parsed.defaultType);
      }
    } catch {
      saved = null; // private window or storage blocked
    }
    const guessed = guessMapping(hs);
    if (saved) {
      // Keep saved choices only where the column still exists in this file
      const merged: Mapping = { ...guessed };
      for (const f of IMPORT_FIELDS) {
        const col = saved[f];
        if (col && hs.includes(col)) merged[f] = col;
      }
      setMapping(merged);
    } else {
      setMapping(guessed);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setParseError(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter((h) => h.length > 0);
        if (hs.length === 0) {
          setParseError("No header row found. The first line of the file should name the columns.");
          return;
        }
        setHeaders(hs);
        setRows(res.data);
        applySavedOrGuessedMapping(hs);
      },
      error: (err) => setParseError(err.message),
    });
  }

  const mappedRows = useMemo<ImportRow[]>(() => {
    return rows.map((r) => {
      const out: ImportRow = {};
      for (const f of IMPORT_FIELDS) {
        const col = mapping[f];
        if (col) out[f] = r[col] ?? null;
      }
      return out;
    });
  }, [rows, mapping]);

  const nameMapped = !!mapping.full_name;
  const contactMapped = !!mapping.email || !!mapping.mobile;
  const ready = headers.length > 0 && nameMapped && contactMapped && rows.length > 0;

  function submit() {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey(slug), JSON.stringify({ mapping, defaultType }));
    } catch {
      // ignore
    }
    startTransition(async () => {
      try {
        const res = await importRespondents(slug, { rows: mappedRows, defaultType });
        setResult(res);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Import failed.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <label className="label" htmlFor="csv">1. Choose a CSV file</label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} className="block text-sm" />
        {fileName && rows.length > 0 && (
          <p className="mt-2 text-sm text-stone-600">
            {fileName}: {rows.length} row{rows.length === 1 ? "" : "s"}, {headers.length} columns.
          </p>
        )}
        {parseError && <p className="mt-2 text-sm text-red-700">{parseError}</p>}
      </div>

      {headers.length > 0 && (
        <>
          <div className="card">
            <h2 className="text-base font-semibold">2. Match the columns</h2>
            <p className="mb-4 mt-1 text-sm text-stone-600">A name plus an email or a mobile is the minimum. Anything else is optional.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((f) => (
                <div key={f}>
                  <label className="label" htmlFor={`map-${f}`}>{IMPORT_FIELD_LABEL[f]}</label>
                  <select
                    id={`map-${f}`}
                    className="input"
                    value={mapping[f] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))}
                  >
                    <option value="">— not in this file —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
              <div>
                <label className="label" htmlFor="default-type">Type when the file doesn’t say</label>
                <select id="default-type" className="input" value={defaultType} onChange={(e) => setDefaultType(e.target.value as RespondentType)}>
                  {(Object.keys(RESPONDENT_TYPE_LABEL) as RespondentType[]).map((t) => (
                    <option key={t} value={t}>{RESPONDENT_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </div>
            </div>
            {!nameMapped && <p className="mt-3 text-sm text-amber-700">Choose the column that holds the person’s name.</p>}
            {nameMapped && !contactMapped && <p className="mt-3 text-sm text-amber-700">Choose an email or mobile column.</p>}
          </div>

          <div className="card overflow-x-auto">
            <h2 className="text-base font-semibold">3. Check the first rows</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  {IMPORT_FIELDS.filter((f) => mapping[f]).map((f) => (
                    <th key={f} className="py-2 pr-4">{IMPORT_FIELD_LABEL[f].replace(/ \(.*\)$/, "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappedRows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    {IMPORT_FIELDS.filter((f) => mapping[f]).map((f) => (
                      <td key={f} className="py-2 pr-4 text-stone-700">{r[f] || <span className="text-stone-300">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" className="btn-primary" disabled={!ready || pending} onClick={submit}>
                {pending ? "Importing…" : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
              </button>
              <span className="text-xs text-stone-500">Your column choices are remembered on this computer.</span>
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="card">
          <h2 className="text-base font-semibold">Done</h2>
          <p className="mt-1 text-sm text-stone-700">
            {result.created} added, {result.updated} updated, {result.skipped.length} skipped.
          </p>
          {result.skipped.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-2 pr-4">Row</th>
                  <th className="py-2 pr-4">Who</th>
                  <th className="py-2">Why skipped</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((s, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-2 pr-4 text-stone-500">{s.row || "—"}</td>
                    <td className="py-2 pr-4">{s.name}</td>
                    <td className="py-2 text-stone-700">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <a href={`/app/${slug}/respondents`} className="btn-secondary mt-4">Back to People</a>
        </div>
      )}
    </div>
  );
}
