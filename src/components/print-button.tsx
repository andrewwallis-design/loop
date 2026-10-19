"use client";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-primary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
