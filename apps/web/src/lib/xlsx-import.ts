import * as XLSX from "xlsx";

/** Parse the first sheet of an .xlsx/.csv into headers + row objects (keyed by header). */
export async function parseSpreadsheet(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { headers: [], rows: [] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const headerRow = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] as unknown[] | undefined) ?? [];
  const headers = rows.length ? Object.keys(rows[0]!) : headerRow.map((h) => String(h));
  return { headers, rows };
}
