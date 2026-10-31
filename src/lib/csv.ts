// Minimal RFC 4180 CSV parsing/serialization for device inventory import/export.
// Imported rows are recorded as source = "csv_import" and are NEVER hardware verified;
// verification only comes from agent-reported identity (Phase 2+).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

export const DEVICE_CSV_COLUMNS = [
  "asset_tag",
  "manufacturer",
  "model",
  "system_serial",
  "intake_condition",
  "received_at",
  "notes",
] as const;

const CONDITIONS = ["good", "fair", "damaged", "missing_parts", "unknown"] as const;
export type IntakeCondition = (typeof CONDITIONS)[number];

export interface DeviceImportRow {
  asset_tag: string;
  manufacturer: string | null;
  model: string | null;
  system_serial: string | null;
  intake_condition: IntakeCondition;
  received_at: string | null;
  notes: string | null;
  source: "csv_import";
  hardware_verified: false;
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportResult {
  rows: DeviceImportRow[];
  issues: ImportIssue[];
}

export const MAX_IMPORT_ROWS = 2000;

export function validateDeviceCsv(text: string): ImportResult {
  const table = parseCsv(text);
  const issues: ImportIssue[] = [];
  if (table.length === 0) return { rows: [], issues: [{ line: 1, message: "File is empty" }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (idx("asset_tag") === -1) {
    return { rows: [], issues: [{ line: 1, message: "Missing required column: asset_tag" }] };
  }
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      issues: [{ line: 1, message: `Too many rows (${body.length}); limit is ${MAX_IMPORT_ROWS}` }],
    };
  }
  const seen = new Set<string>();
  const rows: DeviceImportRow[] = [];
  const get = (r: string[], name: string) => {
    const i = idx(name);
    const v = i === -1 ? "" : (r[i] ?? "").trim();
    return v === "" ? null : v;
  };
  body.forEach((r, n) => {
    const line = n + 2;
    const tag = get(r, "asset_tag");
    if (!tag) { issues.push({ line, message: "asset_tag is required" }); return; }
    if (tag.length > 64) { issues.push({ line, message: "asset_tag longer than 64 characters" }); return; }
    const key = tag.toLowerCase();
    if (seen.has(key)) { issues.push({ line, message: `Duplicate asset_tag "${tag}" in file` }); return; }
    seen.add(key);
    const condRaw = (get(r, "intake_condition") ?? "unknown").toLowerCase().replace(/\s+/g, "_");
    if (!(CONDITIONS as readonly string[]).includes(condRaw)) {
      { issues.push({ line, message: `Unknown intake_condition "${condRaw}"` }); return; }
    }
    const received = get(r, "received_at");
    if (received && Number.isNaN(Date.parse(received))) {
      { issues.push({ line, message: `Invalid received_at date "${received}"` }); return; }
    }
    rows.push({
      asset_tag: tag,
      manufacturer: get(r, "manufacturer"),
      model: get(r, "model"),
      system_serial: get(r, "system_serial"),
      intake_condition: condRaw as IntakeCondition,
      received_at: received ? new Date(received).toISOString() : null,
      notes: get(r, "notes"),
      source: "csv_import",
      hardware_verified: false,
    });
  });
  return { rows, issues };
}
