// ─────────────────────────────────────────────────────────────────────────────
// exportData — shared CSV/JSON export used by the directory pages' Export
// button (Private Market, VC Directory, …). Client-side only: builds the
// file in memory and triggers a browser download, no server round-trip
// beyond whatever the caller already fetched.
// ─────────────────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json";

export interface ExportColumn<T> {
  label: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(","));
  return [header, ...lines].join("\r\n");
}

function toJson<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, string | number | boolean | null> = {};
    for (const c of columns) obj[c.label] = c.value(row) ?? null;
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds the file for `format` and starts the browser download. */
export function exportRows<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filenameBase: string,
  format: ExportFormat,
) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    downloadFile(`${filenameBase}-${stamp}.csv`, toCsv(rows, columns), "text/csv;charset=utf-8");
  } else {
    downloadFile(`${filenameBase}-${stamp}.json`, toJson(rows, columns), "application/json;charset=utf-8");
  }
}
