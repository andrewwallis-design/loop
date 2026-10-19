/** Inline notice driven by `?ok=` / `?error=` query parameters after a server action redirect. */
export function Flash({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error) {
    return <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  }
  if (ok) {
    return <p className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</p>;
  }
  return null;
}
