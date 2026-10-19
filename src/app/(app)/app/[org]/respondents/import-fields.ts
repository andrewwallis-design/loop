/** Target fields a CSV column can be mapped to (shared by the client editor and the import action). */
export const IMPORT_FIELDS = [
  "full_name",
  "email",
  "mobile",
  "type",
  "relates_to",
  "external_ref",
  "relationship_start",
  "event_date",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string | null>>;

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  full_name: "Full name (required)",
  email: "Email",
  mobile: "Mobile",
  type: "Type",
  relates_to: "Relates to (next of kin)",
  external_ref: "Reference (ACP id, booking ref)",
  relationship_start: "Relationship start",
  event_date: "Event date",
};

export interface ImportResult {
  created: number;
  updated: number;
  skipped: Array<{ row: number; name: string; reason: string }>;
}
